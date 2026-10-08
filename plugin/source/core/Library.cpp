#include "Library.h"
#include "Json.h"
#include "Pattern.h"

#include <algorithm>

namespace drums
{
juce::String toString (LibraryKind k)
{
    switch (k)
    {
        case LibraryKind::factory: return "factory";
        case LibraryKind::catalog: return "catalog";
        case LibraryKind::user: return "user";
        case LibraryKind::linked: return "linked";
    }
    return "catalog";
}

std::optional<LibraryKind> libraryKindFrom (const juce::String& s)
{
    if (s == "factory") return LibraryKind::factory;
    if (s == "catalog") return LibraryKind::catalog;
    if (s == "user") return LibraryKind::user;
    if (s == "linked") return LibraryKind::linked;
    return std::nullopt;
}

namespace
{
    constexpr const char* registryFormat = "vdvm-library-registry";
    constexpr const char* libraryFormat = "vdvm-library";
    // Formats written before the product was named V.D.V.M; still read.
    constexpr const char* legacyRegistryFormat = "drums-library-registry";
    constexpr const char* legacyLibraryFormat = "drums-library";

    juce::var loadJsonFile (const juce::File& f, juce::String& error)
    {
        if (! f.existsAsFile())
        {
            error = "missing " + f.getFullPathName();
            return {};
        }
        const auto parsed = parseJson (f.loadFileAsString(), error);
        if (! parsed)
        {
            error = f.getFileName() + ": " + error;
            return {};
        }
        return *parsed;
    }

    juce::String randomHex (int chars)
    {
        juce::String s;
        auto& r = juce::Random::getSystemRandom();
        while (s.length() < chars)
            s << juce::String::toHexString (r.nextInt64()).paddedLeft ('0', 16);
        return s.substring (0, chars).toLowerCase();
    }
} // namespace

std::optional<LibraryRecord> readLibraryFile (const juce::File& root, juce::String& error)
{
    const auto json = loadJsonFile (root.getChildFile ("library.json"), error);
    if (json.isVoid())
        return std::nullopt;
    if ((json["format"].toString() != libraryFormat && json["format"].toString() != legacyLibraryFormat) || (int) json["version"] != 1)
    {
        error = "library.json is not a V.D.V.M library description";
        return std::nullopt;
    }
    LibraryRecord r;
    r.id = json["id"].toString();
    r.name = json["name"].toString();
    const auto kind = libraryKindFrom (json["kind"].toString());
    if (! isValidId (r.id) || r.name.isEmpty() || ! kind || (*kind != LibraryKind::user && *kind != LibraryKind::linked))
    {
        error = "library.json has an invalid id, name or kind";
        return std::nullopt;
    }
    r.kind = *kind;
    r.root = root;
    if (r.kind == LibraryKind::linked)
        r.linkedRoot = juce::File (json["linkedRoot"].toString());
    r.addedAt = json["createdAt"].toString();
    return r;
}

bool writeLibraryFile (const LibraryRecord& rec)
{
    auto o = makeObject();
    setProp (o, "format", libraryFormat);
    setProp (o, "version", 1);
    setProp (o, "id", rec.id);
    setProp (o, "name", rec.name);
    setProp (o, "kind", toString (rec.kind));
    if (rec.kind == LibraryKind::linked)
        setProp (o, "linkedRoot", rec.linkedRoot.getFullPathName());
    setProp (o, "createdAt", rec.addedAt);
    return writeFileAtomic (rec.root.getChildFile ("library.json"), stableJson (o));
}

// --- Library -------------------------------------------------------------------

std::shared_ptr<Library> Library::open (const LibraryRecord& record, juce::String& error)
{
    auto lib = std::shared_ptr<Library> (new Library());
    lib->rec = record;
    if (! record.root.isDirectory())
    {
        error = "Library folder not found: " + record.root.getFullPathName();
        return nullptr;
    }
    const auto indexFile = resolveUnder (record.root, "catalog/index.json");
    if (! indexFile)
    {
        error = "Not a V.D.V.M catalog folder (no catalog/index.json): " + record.root.getFullPathName();
        return nullptr;
    }
    const auto json = loadJsonFile (*indexFile, error);
    if (json.isVoid())
        return nullptr;
    juce::StringArray errors;
    auto index = parseIndex (json, errors);
    if (! index)
    {
        error = "Catalog index is invalid: " + errors[0];
        return nullptr;
    }
    const auto problems = checkIndex (*index);
    if (! problems.isEmpty())
    {
        error = "Catalog index is inconsistent: " + problems[0];
        return nullptr;
    }
    lib->idx = std::move (*index);
    if (lib->writable())
    {
        juce::String ignored;
        const auto samples = loadJsonFile (record.root.getChildFile ("samples.json"), ignored);
        if (auto* obj = samples["samples"].getDynamicObject())
        {
            for (const auto& p : obj->getProperties())
            {
                const auto& v = p.value;
                ImportedSample s;
                s.sha256 = p.name.toString();
                s.name = v["name"].toString();
                s.originalPath = v["originalPath"].toString();
                s.format = v["format"].toString();
                s.suggestedRole = v["suggestedRole"].toString();
                s.importedAt = v["importedAt"].toString();
                s.channels = (int) v["channels"];
                s.sampleRate = (int) v["sampleRate"];
                s.durationSec = (double) v["durationSec"];
                s.bytes = (juce::int64) v["bytes"];
                if (! v["peakDbfs"].isVoid())
                    s.peakDbfs = (double) v["peakDbfs"];
                if (isSha256 (s.sha256))
                    lib->importedTable[s.sha256] = s;
            }
        }
    }
    if (record.kind == LibraryKind::linked)
    {
        juce::String linkError;
        const auto links = loadJsonFile (record.root.getChildFile ("links.json"), linkError);
        if (auto* obj = links["links"].getDynamicObject())
        {
            for (const auto& p : obj->getProperties())
            {
                LinkEntry e;
                e.path = p.value["path"].toString();
                e.bytes = (juce::int64) p.value["bytes"];
                e.modifiedMs = (juce::int64) p.value["modifiedMs"];
                lib->linkTable[p.name.toString()] = e;
            }
        }
    }
    return lib;
}

std::optional<KitManifest> Library::loadKit (const juce::String& kitId, juce::String& error) const
{
    const auto* entry = idx.kitEntry (kitId);
    if (entry == nullptr)
    {
        error = "Kit " + kitId + " is not in " + rec.name + ".";
        return std::nullopt;
    }
    {
        std::lock_guard lock (cacheMutex);
        if (const auto it = kitCache.find (entry->id); it != kitCache.end())
            return it->second;
    }
    const auto file = resourceFile (entry->url);
    if (! file)
    {
        error = "Kit " + entry->label + " has an unsafe location.";
        return std::nullopt;
    }
    const auto json = loadJsonFile (*file, error);
    if (json.isVoid())
    {
        error = "Kit " + entry->label + " could not be read: " + error;
        return std::nullopt;
    }
    juce::StringArray errors;
    auto kit = parseKit (json, errors);
    if (! kit)
    {
        error = "Kit " + entry->label + " is invalid: " + errors[0];
        return std::nullopt;
    }
    const auto problems = checkKit (*kit, entry);
    if (! problems.isEmpty())
    {
        error = "Kit " + entry->label + " is inconsistent: " + problems[0];
        return std::nullopt;
    }
    if (revisionOf (json) != kit->revision)
    {
        error = "Kit " + entry->label + " does not match its revision (file changed or damaged).";
        return std::nullopt;
    }
    std::lock_guard lock (cacheMutex);
    kitCache[kit->id] = *kit;
    return kit;
}

std::optional<juce::File> Library::sampleFile (const Sample& s) const
{
    if (rec.kind == LibraryKind::linked)
    {
        const auto it = linkTable.find (s.blobSha256);
        if (it == linkTable.end())
            return std::nullopt;
        // Link paths come from our own import, but the file is still untrusted: confine it.
        const auto rel = it->second.path;
        if (rel.isEmpty() || rel.startsWithChar ('/') || rel.contains ("\\") || rel.contains (".."))
            return std::nullopt;
        const auto base = canonicalFile (rec.linkedRoot);
        auto file = base.getChildFile (rel);
        if (file.exists())
            file = canonicalFile (file);
        if (! file.isAChildOf (base))
            return std::nullopt;
        return file;
    }
    return resolveUnder (rec.root, s.url);
}

std::optional<juce::File> Library::resourceFile (const juce::String& rel) const
{
    return resolveUnder (rec.root, rel);
}

// --- LibraryManager --------------------------------------------------------------

LibraryManager::LibraryManager (juce::File d, std::vector<juce::File> f) : dataDir (std::move (d)), factoryDirs (std::move (f))
{
    refresh();
}

namespace
{
    /** Per-user data folder named `name` (the product folder, or its pre-rename name). */
    juce::File userDataFolder (const juce::String& name)
    {
#if JUCE_MAC
        return juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory).getChildFile ("Application Support").getChildFile (name);
#elif JUCE_WINDOWS
        return juce::File::getSpecialLocation (juce::File::windowsLocalAppData).getChildFile (name);
#else
        const auto xdg = juce::SystemStats::getEnvironmentVariable ("XDG_DATA_HOME", {});
        return (xdg.isNotEmpty() ? juce::File (xdg) : juce::File ("~/.local/share")).getChildFile (name);
#endif
    }

    std::vector<juce::File> sharedFactoryFolders (const juce::String& name)
    {
#if JUCE_MAC
        return { juce::File ("/Library/Application Support").getChildFile (name).getChildFile ("Factory") };
#elif JUCE_WINDOWS
        return { juce::File::getSpecialLocation (juce::File::commonApplicationDataDirectory).getChildFile (name).getChildFile ("Factory") };
#else
        return { juce::File ("/usr/local/share").getChildFile (name).getChildFile ("Factory"),
                 juce::File ("/usr/share").getChildFile (name).getChildFile ("Factory") };
#endif
    }

    constexpr const char* productFolder = "V.D.V.M";
    constexpr const char* legacyFolder = "Drums"; // before the product was named V.D.V.M
} // namespace

juce::File LibraryManager::defaultDataDir()
{
    if (const auto env = juce::SystemStats::getEnvironmentVariable ("VDVM_DATA_DIR", {}); env.isNotEmpty())
        return juce::File (env);
    return userDataFolder (productFolder);
}

std::vector<juce::File> LibraryManager::defaultFactoryDirs()
{
    std::vector<juce::File> dirs;
    if (const auto env = juce::SystemStats::getEnvironmentVariable ("VDVM_FACTORY_DIR", {}); env.isNotEmpty())
        dirs.emplace_back (env);
    dirs.push_back (defaultDataDir().getChildFile ("Factory"));
    for (const auto& d : sharedFactoryFolders (productFolder))
        dirs.push_back (d);
    // A factory library installed under the old name still counts.
    for (const auto& d : sharedFactoryFolders (legacyFolder))
        dirs.push_back (d);
    return dirs;
}

bool LibraryManager::migrateLegacyDataDir()
{
    if (juce::SystemStats::getEnvironmentVariable ("VDVM_DATA_DIR", {}).isNotEmpty())
        return false;
    return migrateDataDir (userDataFolder (legacyFolder), userDataFolder (productFolder));
}

bool LibraryManager::migrateDataDir (const juce::File& from, const juce::File& to)
{
    if (! from.isDirectory() || to.exists())
        return false;
    if (! from.moveFileTo (to))
        return false;
    // Registered locations inside the moved folder (user libraries, factory) move with it.
    const auto registry = to.getChildFile ("library-registry.json");
    if (registry.existsAsFile())
    {
        juce::String error;
        if (auto json = parseJson (registry.loadFileAsString(), error))
        {
            const auto oldPrefix = from.getFullPathName();
            if (auto* list = (*json)["libraries"].getArray())
            {
                for (auto& lib : *list)
                {
                    for (const char* key : { "path", "linkedRoot" })
                    {
                        const auto p = lib[key].toString();
                        if (p == oldPrefix || p.startsWith (oldPrefix + juce::File::getSeparatorString()))
                            lib.getDynamicObject()->setProperty (key, to.getFullPathName() + p.substring (oldPrefix.length()));
                    }
                }
            }
            setProp (*json, "format", registryFormat);
            writeFileAtomic (registry, stableJson (*json));
        }
    }
    return true;
}

void LibraryManager::refresh()
{
    std::lock_guard lock (mutex);
    recs.clear();
    for (const auto& dir : factoryDirs)
    {
        if (dir.getChildFile ("catalog/index.json").existsAsFile())
        {
            LibraryRecord r;
            r.id = "factory";
            r.kind = LibraryKind::factory;
            r.name = "V.D.V.M Factory";
            r.root = dir;
            r.discovered = true;
            recs.push_back (r);
            break;
        }
    }
    juce::String error;
    const auto json = loadJsonFile (dataDir.getChildFile ("library-registry.json"), error);
    if ((json["format"].toString() == registryFormat || json["format"].toString() == legacyRegistryFormat) && json["libraries"].isArray())
    {
        for (const auto& v : *json["libraries"].getArray())
        {
            LibraryRecord r;
            r.id = v["id"].toString();
            const auto kind = libraryKindFrom (v["kind"].toString());
            if (! isValidId (r.id) || ! kind || *kind == LibraryKind::factory || record (r.id))
                continue;
            r.kind = *kind;
            r.name = v["name"].toString();
            r.root = juce::File (v["path"].toString());
            r.linkedRoot = juce::File (v["linkedRoot"].toString());
            r.addedAt = v["addedAt"].toString();
            // User and linked libraries describe themselves; their file wins over the registry copy.
            if (r.kind == LibraryKind::user || r.kind == LibraryKind::linked)
            {
                juce::String e;
                if (const auto own = readLibraryFile (r.root, e); own && own->id == r.id)
                {
                    r.name = own->name;
                    r.kind = own->kind;
                    if (own->kind == LibraryKind::linked)
                        r.linkedRoot = own->linkedRoot;
                }
            }
            recs.push_back (r);
        }
    }
    for (auto it = opened.begin(); it != opened.end();)
        it = std::any_of (recs.begin(), recs.end(), [&] (const auto& r) { return r.id == it->first; }) ? std::next (it) : opened.erase (it);
}

std::vector<LibraryRecord> LibraryManager::records() const
{
    std::lock_guard lock (mutex);
    return recs;
}

std::optional<LibraryRecord> LibraryManager::record (const juce::String& id) const
{
    // Callers may hold `mutex` (refresh); records are read without it there.
    for (const auto& r : recs)
        if (r.id == id)
            return r;
    return std::nullopt;
}

std::shared_ptr<Library> LibraryManager::get (const juce::String& id, juce::String& error)
{
    LibraryRecord rec;
    {
        std::lock_guard lock (mutex);
        if (const auto it = opened.find (id); it != opened.end())
            return it->second;
        const auto r = record (id);
        if (! r)
        {
            error = "Library " + id + " is not registered on this computer.";
            return nullptr;
        }
        rec = *r;
    }
    auto lib = Library::open (rec, error);
    if (lib)
    {
        std::lock_guard lock (mutex);
        opened[id] = lib;
    }
    return lib;
}

void LibraryManager::invalidate (const juce::String& id)
{
    std::lock_guard lock (mutex);
    opened.erase (id);
}

void LibraryManager::saveRegistryLocked() const
{
    auto root = makeObject();
    setProp (root, "format", registryFormat);
    setProp (root, "version", 1);
    juce::Array<juce::var> list;
    for (const auto& r : recs)
    {
        if (r.discovered)
            continue;
        auto o = makeObject();
        setProp (o, "id", r.id);
        setProp (o, "kind", toString (r.kind));
        setProp (o, "name", r.name);
        setProp (o, "path", r.root.getFullPathName());
        if (r.kind == LibraryKind::linked)
            setProp (o, "linkedRoot", r.linkedRoot.getFullPathName());
        setProp (o, "addedAt", r.addedAt);
        list.add (o);
    }
    setProp (root, "libraries", list);
    writeFileAtomic (dataDir.getChildFile ("library-registry.json"), stableJson (root));
}

juce::String LibraryManager::uniqueIdLocked (const juce::String& base) const
{
    for (;;)
    {
        const auto id = base + "-" + randomHex (10);
        if (! record (id))
            return id;
    }
}

std::optional<juce::File> findCatalogRoot (const juce::File& chosen)
{
    const auto isRoot = [] (const juce::File& f) { return f.getChildFile ("catalog/index.json").existsAsFile(); };
    // The folder itself; its parent when the catalog/ folder was chosen; a built public/ beside or inside it
    // (a source checkout of the project, whose own catalog/ holds source records, not a playable catalog).
    for (const auto& candidate : { chosen, chosen.getParentDirectory(), chosen.getChildFile ("public"),
                                   chosen.getParentDirectory().getChildFile ("public") })
    {
        if (candidate == chosen.getParentDirectory() && ! chosen.getChildFile ("index.json").existsAsFile())
            continue;
        if (isRoot (candidate))
            return candidate;
    }
    return std::nullopt;
}

juce::String LibraryManager::addCatalog (const juce::File& chosen, juce::String& error)
{
    // A user library folder registers as itself (writable); anything else is a read-only catalog.
    if (chosen.getChildFile ("library.json").existsAsFile())
        return addExistingUserLibrary (chosen, error);
    const auto found = findCatalogRoot (chosen);
    if (! found)
    {
        error = chosen.getFullPathName() + " is not a playable V.D.V.M catalog. Choose the folder that contains catalog/index.json and media/"
                + (chosen.getChildFile ("schema").isDirectory() ? " (catalog source records are built into public/ by npm run catalog:prepare)." : ".");
        return {};
    }
    const auto root = *found;
    LibraryRecord r;
    r.kind = LibraryKind::catalog;
    r.root = root;
    // public/ of a checkout is named after the checkout, not "public".
    r.name = root.getFileName() == "public" ? root.getParentDirectory().getFileName() : root.getFileName();
    r.addedAt = isoNow();
    if (! Library::open (r, error))
        return {};
    std::lock_guard lock (mutex);
    for (const auto& existing : recs)
    {
        if (existing.root == root && existing.kind != LibraryKind::linked)
        {
            error = "That catalog is already added as " + existing.name + ".";
            return {};
        }
    }
    r.id = uniqueIdLocked ("catalog");
    recs.push_back (r);
    saveRegistryLocked();
    return r.id;
}

juce::String LibraryManager::addExistingUserLibrary (const juce::File& root, juce::String& error)
{
    auto r = readLibraryFile (root, error);
    if (! r)
        return {};
    if (! Library::open (*r, error))
        return {};
    std::lock_guard lock (mutex);
    if (const auto existing = record (r->id))
    {
        error = "That library is already added as " + existing->name + ".";
        return {};
    }
    recs.push_back (*r);
    saveRegistryLocked();
    return r->id;
}

namespace
{
    bool writeEmptyCatalog (const LibraryRecord& r, juce::String& error)
    {
        // A valid, empty V.D.V.M v1 catalog: no machines, no kits.
        CatalogIndex index;
        index.creditsUrl = "catalog/credits.json";
        auto json = toJson (index);
        setProp (json, "revision", revisionOf (json));
        auto credits = makeObject();
        setProp (credits, "schemaVersion", 1);
        setProp (credits, "credits", makeObject());
        if (! writeFileAtomic (r.root.getChildFile ("catalog/credits.json"), stableJson (credits))
            || ! writeFileAtomic (r.root.getChildFile ("catalog/index.json"), stableJson (json)) || ! writeLibraryFile (r))
        {
            error = "Could not write to " + r.root.getFullPathName();
            return false;
        }
        return true;
    }

    juce::String folderNameFor (const juce::String& name)
    {
        auto s = juce::File::createLegalFileName (name).trim();
        return s.isEmpty() ? juce::String ("Library") : s;
    }
} // namespace

juce::String LibraryManager::createUserLibrary (const juce::String& name, juce::String& error, const juce::File& location)
{
    LibraryRecord r;
    r.kind = LibraryKind::user;
    r.name = name.trim().isEmpty() ? juce::String ("My Sounds") : name.trim();
    r.addedAt = isoNow();
    {
        std::lock_guard lock (mutex);
        r.id = uniqueIdLocked ("user");
    }
    r.root = location != juce::File() ? location
                                      : userLibrariesDirectory().getChildFile (folderNameFor (r.name)).getNonexistentSibling (false);
    if (r.root.exists() && ! r.root.isDirectory())
    {
        error = r.root.getFullPathName() + " is not a folder.";
        return {};
    }
    if (r.root.getChildFile ("catalog/index.json").exists())
    {
        error = "That folder already holds a catalog.";
        return {};
    }
    if (! writeEmptyCatalog (r, error))
        return {};
    std::lock_guard lock (mutex);
    recs.push_back (r);
    saveRegistryLocked();
    return r.id;
}

juce::String LibraryManager::createLinkedLibrary (const juce::String& name, const juce::File& linkedRoot, juce::String& error)
{
    if (! linkedRoot.isDirectory())
    {
        error = "Folder not found: " + linkedRoot.getFullPathName();
        return {};
    }
    LibraryRecord r;
    r.kind = LibraryKind::linked;
    r.name = name.trim().isEmpty() ? linkedRoot.getFileName() : name.trim();
    r.linkedRoot = linkedRoot;
    r.addedAt = isoNow();
    {
        std::lock_guard lock (mutex);
        r.id = uniqueIdLocked ("linked");
    }
    r.root = userLibrariesDirectory().getChildFile (folderNameFor (r.name + " (linked)")).getNonexistentSibling (false);
    if (! writeEmptyCatalog (r, error))
        return {};
    auto links = makeObject();
    setProp (links, "links", makeObject());
    writeFileAtomic (r.root.getChildFile ("links.json"), stableJson (links));
    std::lock_guard lock (mutex);
    recs.push_back (r);
    saveRegistryLocked();
    return r.id;
}

bool LibraryManager::remove (const juce::String& id, juce::String& error)
{
    std::lock_guard lock (mutex);
    const auto it = std::find_if (recs.begin(), recs.end(), [&] (const auto& r) { return r.id == id; });
    if (it == recs.end())
    {
        error = "No such library.";
        return false;
    }
    if (it->discovered)
    {
        error = "The factory library is managed by the installer.";
        return false;
    }
    // Removing forgets the location; files stay where they are.
    recs.erase (it);
    opened.erase (id);
    saveRegistryLocked();
    return true;
}

bool LibraryManager::rename (const juce::String& id, const juce::String& name, juce::String& error)
{
    std::lock_guard lock (mutex);
    const auto it = std::find_if (recs.begin(), recs.end(), [&] (const auto& r) { return r.id == id; });
    if (it == recs.end() || it->discovered || name.trim().isEmpty())
    {
        error = "That library cannot be renamed.";
        return false;
    }
    it->name = name.trim();
    if (it->kind == LibraryKind::user || it->kind == LibraryKind::linked)
        writeLibraryFile (*it);
    opened.erase (id);
    saveRegistryLocked();
    return true;
}

bool LibraryManager::relocate (const juce::String& id, const juce::File& newRoot, juce::String& error)
{
    LibraryRecord candidate;
    {
        std::lock_guard lock (mutex);
        const auto r = record (id);
        if (! r || r->discovered)
        {
            error = "That library cannot be moved here.";
            return false;
        }
        candidate = *r;
    }
    if (candidate.kind == LibraryKind::linked)
        candidate.linkedRoot = newRoot;
    else
        candidate.root = newRoot;
    if (candidate.kind == LibraryKind::user)
    {
        const auto own = readLibraryFile (newRoot, error);
        if (! own || own->id != id)
        {
            if (error.isEmpty())
                error = "That folder holds a different library.";
            return false;
        }
    }
    if (! Library::open (candidate, error))
        return false;
    if (candidate.kind == LibraryKind::linked)
        writeLibraryFile (candidate);
    std::lock_guard lock (mutex);
    for (auto& r : recs)
        if (r.id == id)
            r = candidate;
    opened.erase (id);
    saveRegistryLocked();
    return true;
}

std::optional<KitLocation> LibraryManager::findKit (const juce::String& preferred, const juce::String& kitId, const juce::String& revision)
{
    const auto look = [&] (const LibraryRecord& r) -> std::optional<KitLocation>
    {
        juce::String error;
        const auto lib = get (r.id, error);
        if (! lib)
            return std::nullopt;
        const auto* e = lib->index().kitEntry (kitId);
        if (e == nullptr)
            return std::nullopt;
        return KitLocation { r.id, *e, e->revision == revision };
    };
    const auto all = records();
    // The named library wins at any revision (an updated kit is still that kit).
    for (const auto& r : all)
        if (r.id == preferred)
            if (auto found = look (r))
                return found;
    // Elsewhere only the identical kit (same id and content revision) is accepted; a different kit
    // that happens to share the id is never bound silently.
    for (const auto& r : all)
        if (r.id != preferred)
            if (auto found = look (r); found && found->exactRevision)
                return found;
    return std::nullopt;
}
} // namespace drums
