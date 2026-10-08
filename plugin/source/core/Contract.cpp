#include "Contract.h"
#include "Json.h"

#include <climits>
#include <cstdlib>
#include <regex>
#include <set>

namespace drums
{
namespace
{
    const std::set<juce::String> categories { "kick", "snare", "hat", "cymbal", "tom", "clap", "rim", "percussion", "fx", "unknown" };
    const std::set<juce::String> icons { "kick", "snare", "hat-closed", "hat-open", "cymbal", "tom", "clap", "rim", "percussion" };
    const std::set<juce::String> machineKinds { "drum-machine", "keyboard", "synth", "module", "sampler", "unknown" };
    const std::set<juce::String> identityStatuses { "provisional", "verified", "unresolved" };

    bool isRevision (const juce::String& s)
    {
        return s.length() == 16 && s.containsOnly ("0123456789abcdef");
    }

    RedirectMap readRedirects (const juce::var& v, const juce::String& where, juce::StringArray& errors)
    {
        RedirectMap out;
        auto* obj = v.getDynamicObject();
        if (obj == nullptr)
        {
            errors.add (where + " must be an object");
            return out;
        }
        for (const auto& p : obj->getProperties())
        {
            const auto from = p.name.toString();
            if (! p.value.isString() || ! isValidId (from) || ! isValidId (p.value.toString()))
                errors.add (where + ": invalid redirect " + from);
            else
                out[from] = p.value.toString();
        }
        return out;
    }

    std::optional<AssetRef> readAsset (const juce::var& v, const juce::String& where, juce::StringArray& errors)
    {
        if (v.isVoid())
            return std::nullopt;
        if (v.getDynamicObject() == nullptr)
        {
            errors.add (where + " must be an object or null");
            return std::nullopt;
        }
        FieldReader r { v, where, errors };
        AssetRef a;
        a.id = r.string ("id");
        a.url = r.string ("url");
        a.sha256 = r.string ("sha256");
        a.alt = r.string ("alt");
        a.creditId = r.string ("creditId");
        a.width = r.integer ("width", 0);
        a.height = r.integer ("height", 0);
        if (! isSha256 (a.sha256))
            errors.add (where + ": sha256 is not a lowercase hex digest");
        return a;
    }

    void requireId (const juce::String& id, const juce::String& where, juce::StringArray& errors)
    {
        if (! isValidId (id))
            errors.add (where + ": invalid id \"" + id + "\"");
    }
} // namespace

bool isSafeRelativeUrl (const juce::String& rel)
{
    if (rel.isEmpty() || rel.length() > 512 || rel.startsWithChar ('/'))
        return false;
    if (! rel.containsOnly ("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~/-"))
        return false;
    for (const auto& seg : juce::StringArray::fromTokens (rel, "/", ""))
        if (seg.isEmpty() || seg == "." || seg == "..")
            return false;
    return true;
}

bool isValidId (const juce::String& id)
{
    static const std::regex re ("^[a-z0-9]+(-[a-z0-9]+)*$");
    return id.length() > 0 && id.length() <= 128 && std::regex_match (id.toStdString(), re);
}

bool isSha256 (const juce::String& s)
{
    return s.length() == 64 && s.containsOnly ("0123456789abcdef");
}

juce::File canonicalFile (const juce::File& f)
{
#if JUCE_WINDOWS
    return f;
#else
    char buf[PATH_MAX];
    if (::realpath (f.getFullPathName().toRawUTF8(), buf) != nullptr)
        return juce::File (juce::String::fromUTF8 (buf));
    return f;
#endif
}

std::optional<juce::File> resolveUnder (const juce::File& root, const juce::String& rel)
{
    if (! isSafeRelativeUrl (rel))
        return std::nullopt;
    const auto base = canonicalFile (root);
    const auto file = base.getChildFile (rel);
    // rel has no ".." segments, so only a symlinked component can leave the root: resolve the deepest
    // existing ancestor and append the rest.
    auto existing = file;
    juce::String rest;
    while (! existing.exists() && existing != base && existing.isAChildOf (base))
    {
        rest = existing.getFileName() + (rest.isEmpty() ? "" : "/" + rest);
        existing = existing.getParentDirectory();
    }
    auto real = canonicalFile (existing);
    if (rest.isNotEmpty())
        real = real.getChildFile (rest);
    if (! real.isAChildOf (base))
        return std::nullopt;
    return real;
}

std::optional<juce::String> resolveRedirect (const RedirectMap& map, const juce::String& id)
{
    std::set<juce::String> seen;
    auto cur = id;
    for (auto it = map.find (cur); it != map.end(); it = map.find (cur))
    {
        if (! seen.insert (cur).second)
            return std::nullopt;
        cur = it->second;
    }
    return cur;
}

const KitEntry* CatalogIndex::kitEntry (const juce::String& id) const
{
    const auto cur = resolveRedirect (kitRedirects, id);
    if (! cur)
        return nullptr;
    for (const auto& k : kits)
        if (k.id == *cur)
            return &k;
    return nullptr;
}

const Machine* CatalogIndex::machine (const juce::String& id) const
{
    const auto cur = resolveRedirect (machineRedirects, id);
    if (! cur)
        return nullptr;
    for (const auto& m : machines)
        if (m.id == *cur)
            return &m;
    return nullptr;
}

juce::String CatalogIndex::resolveSampleId (const juce::String& id) const
{
    return resolveRedirect (sampleRedirects, id).value_or (id);
}

const Sample* KitManifest::sample (const juce::String& id) const
{
    for (const auto& s : samples)
        if (s.id == id)
            return &s;
    return nullptr;
}

const Slot* KitManifest::slot (const juce::String& id) const
{
    for (const auto& s : slots)
        if (s.id == id)
            return &s;
    return nullptr;
}

std::optional<CatalogIndex> parseIndex (const juce::var& json, juce::StringArray& errors)
{
    const int before = errors.size();
    if (json.getDynamicObject() == nullptr)
    {
        errors.add ("index must be a JSON object");
        return std::nullopt;
    }
    FieldReader r { json, "index", errors };
    CatalogIndex index;
    index.raw = json;
    index.schemaVersion = r.integer ("schemaVersion", 0);
    if (index.schemaVersion != supportedSchemaMajor)
    {
        errors.add ("Catalog format version " + juce::String (index.schemaVersion) + " is not supported by this plugin version.");
        return std::nullopt;
    }
    index.revision = r.string ("revision");
    if (! isRevision (index.revision))
        errors.add ("index: revision is not 16 hex chars");
    index.creditsUrl = r.string ("creditsUrl");
    if (const auto& ms = r.array ("machines"); ms.isArray())
    {
        for (const auto& m : *ms.getArray())
        {
            FieldReader mr { m, "machine", errors };
            Machine mach;
            mach.id = mr.string ("id");
            mr.where = "machine " + mach.id;
            requireId (mach.id, mr.where, errors);
            mach.manufacturer = mr.string ("manufacturer");
            mach.model = mr.string ("model");
            mach.displayName = mr.string ("displayName");
            mach.kind = mr.string ("kind");
            mach.identityStatus = mr.string ("identityStatus");
            if (machineKinds.count (mach.kind) == 0)
                errors.add (mr.where + ": unknown kind " + mach.kind);
            if (identityStatuses.count (mach.identityStatus) == 0)
                errors.add (mr.where + ": unknown identityStatus " + mach.identityStatus);
            if (! m["aliases"].isArray())
                errors.add (mr.where + ": aliases must be an array");
            mach.logo = readAsset (m["logo"], mr.where + " logo", errors);
            mach.photo = readAsset (m["photo"], mr.where + " photo", errors);
            index.machines.push_back (std::move (mach));
        }
    }
    if (const auto& ks = r.array ("kits"); ks.isArray())
    {
        for (const auto& k : *ks.getArray())
        {
            FieldReader kr { k, "kit entry", errors };
            KitEntry e;
            e.id = kr.string ("id");
            kr.where = "kit entry " + e.id;
            requireId (e.id, kr.where, errors);
            e.machineId = kr.string ("machineId");
            e.label = kr.string ("label");
            e.revision = kr.string ("revision");
            e.url = kr.string ("url");
            if (! isRevision (e.revision))
                errors.add (kr.where + ": revision is not 16 hex chars");
            index.kits.push_back (std::move (e));
        }
    }
    const auto& redirects = r.object ("redirects");
    if (redirects.getDynamicObject() != nullptr)
    {
        index.machineRedirects = readRedirects (redirects["machines"], "redirects.machines", errors);
        index.kitRedirects = readRedirects (redirects["kits"], "redirects.kits", errors);
        index.sampleRedirects = readRedirects (redirects["samples"], "redirects.samples", errors);
    }
    if (errors.size() > before)
        return std::nullopt;
    return index;
}

std::optional<KitManifest> parseKit (const juce::var& json, juce::StringArray& errors)
{
    const int before = errors.size();
    if (json.getDynamicObject() == nullptr)
    {
        errors.add ("kit must be a JSON object");
        return std::nullopt;
    }
    FieldReader r { json, "kit", errors };
    KitManifest kit;
    kit.raw = json;
    kit.schemaVersion = r.integer ("schemaVersion", 0);
    if (kit.schemaVersion != supportedSchemaMajor)
    {
        errors.add ("Kit format version " + juce::String (kit.schemaVersion) + " is not supported by this plugin version.");
        return std::nullopt;
    }
    kit.id = r.string ("id");
    r.where = "kit " + kit.id;
    requireId (kit.id, r.where, errors);
    kit.machineId = r.string ("machineId");
    kit.label = r.string ("label");
    kit.revision = r.string ("revision");
    if (! isRevision (kit.revision))
        errors.add (r.where + ": revision is not 16 hex chars");
    if (const auto& ss = r.array ("samples"); ss.isArray())
    {
        for (const auto& s : *ss.getArray())
        {
            FieldReader sr { s, r.where + " sample", errors };
            Sample smp;
            smp.id = sr.string ("id");
            sr.where = r.where + " sample " + smp.id;
            requireId (smp.id, sr.where, errors);
            smp.label = sr.string ("label", false);
            smp.blobSha256 = sr.string ("blobSha256");
            if (! isSha256 (smp.blobSha256))
                errors.add (sr.where + ": blobSha256 is not a lowercase hex digest");
            smp.url = sr.string ("url");
            smp.bytes = (juce::int64) sr.number ("bytes", 0);
            smp.durationSec = sr.number ("durationSec", 0);
            smp.channels = sr.integer ("channels", 0);
            smp.sampleRate = sr.integer ("sampleRate", 0);
            smp.gainDb = sr.number ("gainDb", 0);
            if (s["peakDbfs"].isVoid())
                smp.peakDbfs.reset();
            else
                smp.peakDbfs = sr.number ("peakDbfs", 0);
            if (smp.channels < 1 || smp.channels > 2)
                errors.add (sr.where + ": channels must be 1 or 2");
            if (smp.sampleRate < 8000 || smp.sampleRate > 192000)
                errors.add (sr.where + ": sampleRate out of range");
            if (smp.durationSec > 60)
                errors.add (sr.where + ": durationSec above 60");
            if (smp.gainDb < -60 || smp.gainDb > 12)
                errors.add (sr.where + ": gainDb out of range");
            kit.samples.push_back (std::move (smp));
        }
        if (kit.samples.empty())
            errors.add (r.where + ": samples must not be empty");
    }
    if (const auto& sl = r.array ("slots"); sl.isArray())
    {
        for (const auto& s : *sl.getArray())
        {
            FieldReader sr { s, r.where + " slot", errors };
            Slot slot;
            slot.id = sr.string ("id");
            sr.where = r.where + " slot " + slot.id;
            requireId (slot.id, sr.where, errors);
            slot.label = sr.string ("label");
            slot.category = sr.string ("category");
            slot.icon = sr.string ("icon");
            if (categories.count (slot.category) == 0)
                errors.add (sr.where + ": unknown category " + slot.category);
            if (icons.count (slot.icon) == 0)
                errors.add (sr.where + ": unknown icon " + slot.icon);
            slot.defaultSampleId = sr.string ("defaultSampleId");
            if (const auto& ids = sr.array ("sampleIds"); ids.isArray())
                for (const auto& id : *ids.getArray())
                    slot.sampleIds.add (id.toString());
            if (slot.sampleIds.isEmpty())
                errors.add (sr.where + ": sampleIds must not be empty");
            const auto& choke = s["chokeGroup"];
            slot.chokeGroup = choke.isString() ? choke.toString() : juce::String();
            slot.gainDb = sr.number ("gainDb", 0);
            kit.slots.push_back (std::move (slot));
        }
        if (kit.slots.empty())
            errors.add (r.where + ": slots must not be empty");
    }
    if (errors.size() > before)
        return std::nullopt;
    return kit;
}

juce::StringArray checkIndex (const CatalogIndex& index)
{
    juce::StringArray errors;
    std::set<juce::String> machineIds, kitIds;
    for (const auto& m : index.machines)
    {
        if (! machineIds.insert (m.id).second)
            errors.add ("duplicate machine id " + m.id);
        for (const auto* art : { &m.logo, &m.photo })
            if (*art && ! isSafeRelativeUrl ((*art)->url))
                errors.add ("machine " + m.id + ": unsafe asset url " + (*art)->url);
    }
    for (const auto& k : index.kits)
    {
        if (! kitIds.insert (k.id).second)
            errors.add ("duplicate kit id " + k.id);
        if (machineIds.count (k.machineId) == 0)
            errors.add ("kit " + k.id + ": unknown machine " + k.machineId);
        if (! isSafeRelativeUrl (k.url))
            errors.add ("kit " + k.id + ": unsafe url " + k.url);
    }
    if (! isSafeRelativeUrl (index.creditsUrl))
        errors.add ("unsafe creditsUrl " + index.creditsUrl);
    const std::pair<const char*, const RedirectMap*> maps[] = { { "machines", &index.machineRedirects },
                                                                 { "kits", &index.kitRedirects },
                                                                 { "samples", &index.sampleRedirects } };
    for (const auto& [kind, map] : maps)
    {
        const juce::String k (kind);
        for (const auto& [from, _] : *map)
        {
            const auto to = resolveRedirect (*map, from);
            if (! to)
                errors.add ("redirects." + k + ": cycle through " + from);
            else if (k == "machines" && machineIds.count (*to) == 0)
                errors.add ("redirects.machines: " + from + " -> unknown " + *to);
            else if (k == "kits" && kitIds.count (*to) == 0)
                errors.add ("redirects.kits: " + from + " -> unknown " + *to);
            if (k == "machines" && machineIds.count (from) > 0)
                errors.add ("redirects.machines: live id " + from + " is also redirected");
            if (k == "kits" && kitIds.count (from) > 0)
                errors.add ("redirects.kits: live id " + from + " is also redirected");
        }
    }
    return errors;
}

juce::StringArray checkKit (const KitManifest& kit, const KitEntry* entry)
{
    juce::StringArray errors;
    const auto where = "kit " + kit.id;
    if (entry != nullptr)
    {
        if (entry->id != kit.id)
            errors.add (where + ": index entry id " + entry->id + " mismatch");
        if (entry->machineId != kit.machineId)
            errors.add (where + ": machineId differs from index");
        if (entry->revision != kit.revision)
            errors.add (where + ": revision differs from index");
    }
    std::set<juce::String> sampleIds, slotIds, used;
    for (const auto& s : kit.samples)
    {
        if (! sampleIds.insert (s.id).second)
            errors.add (where + ": duplicate sample id " + s.id);
        if (! isSafeRelativeUrl (s.url))
            errors.add (where + ": sample " + s.id + " unsafe url");
        if (! (s.bytes > 0) || ! (s.durationSec > 0))
            errors.add (where + ": sample " + s.id + " non-positive size/duration");
        if (! std::isfinite (s.gainDb))
            errors.add (where + ": sample " + s.id + " gain not finite");
    }
    for (const auto& slot : kit.slots)
    {
        if (! slotIds.insert (slot.id).second)
            errors.add (where + ": duplicate slot " + slot.id);
        if (! slot.sampleIds.contains (slot.defaultSampleId))
            errors.add (where + ": slot " + slot.id + " default " + slot.defaultSampleId + " not in sampleIds");
        for (const auto& id : slot.sampleIds)
        {
            if (sampleIds.count (id) == 0)
                errors.add (where + ": slot " + slot.id + " references missing sample " + id);
            used.insert (id);
        }
    }
    for (const auto& id : sampleIds)
        if (used.count (id) == 0)
            errors.add (where + ": sample " + id + " not used by any slot");
    return errors;
}

juce::var toJson (const Sample& s)
{
    auto o = makeObject();
    setProp (o, "id", s.id);
    if (s.label.isNotEmpty())
        setProp (o, "label", s.label);
    setProp (o, "blobSha256", s.blobSha256);
    setProp (o, "url", s.url);
    setProp (o, "bytes", (juce::int64) s.bytes);
    setProp (o, "durationSec", s.durationSec);
    setProp (o, "channels", s.channels);
    setProp (o, "sampleRate", s.sampleRate);
    setProp (o, "gainDb", s.gainDb);
    setProp (o, "peakDbfs", s.peakDbfs ? juce::var (*s.peakDbfs) : juce::var());
    return o;
}

juce::var toJson (const Slot& s)
{
    auto o = makeObject();
    setProp (o, "id", s.id);
    setProp (o, "label", s.label);
    setProp (o, "category", s.category);
    setProp (o, "icon", s.icon);
    setProp (o, "defaultSampleId", s.defaultSampleId);
    juce::Array<juce::var> ids;
    for (const auto& id : s.sampleIds)
        ids.add (id);
    setProp (o, "sampleIds", ids);
    setProp (o, "chokeGroup", s.chokeGroup.isEmpty() ? juce::var() : juce::var (s.chokeGroup));
    setProp (o, "gainDb", s.gainDb);
    return o;
}

juce::var toJson (const KitManifest& k)
{
    auto o = makeObject();
    setProp (o, "schemaVersion", 1);
    setProp (o, "id", k.id);
    setProp (o, "machineId", k.machineId);
    setProp (o, "label", k.label);
    setProp (o, "revision", k.revision);
    juce::Array<juce::var> slots, samples;
    for (const auto& s : k.slots)
        slots.add (toJson (s));
    for (const auto& s : k.samples)
        samples.add (toJson (s));
    setProp (o, "slots", slots);
    setProp (o, "samples", samples);
    return o;
}

juce::var toJson (const Machine& m)
{
    auto o = makeObject();
    setProp (o, "id", m.id);
    setProp (o, "manufacturer", m.manufacturer);
    setProp (o, "model", m.model);
    setProp (o, "displayName", m.displayName);
    setProp (o, "aliases", juce::Array<juce::var>());
    setProp (o, "kind", m.kind);
    setProp (o, "identityStatus", m.identityStatus);
    setProp (o, "logo", juce::var());
    setProp (o, "photo", juce::var());
    setProp (o, "history", juce::var());
    return o;
}

juce::var toJson (const CatalogIndex& index)
{
    auto o = makeObject();
    setProp (o, "schemaVersion", 1);
    setProp (o, "revision", index.revision);
    juce::Array<juce::var> machines, kits;
    for (const auto& m : index.machines)
        machines.add (toJson (m));
    for (const auto& k : index.kits)
    {
        auto e = makeObject();
        setProp (e, "id", k.id);
        setProp (e, "machineId", k.machineId);
        setProp (e, "label", k.label);
        setProp (e, "revision", k.revision);
        setProp (e, "url", k.url);
        kits.add (e);
    }
    setProp (o, "machines", machines);
    setProp (o, "kits", kits);
    auto redirects = makeObject();
    for (const auto& [name, map] : { std::pair { "machines", &index.machineRedirects },
                                     std::pair { "kits", &index.kitRedirects },
                                     std::pair { "samples", &index.sampleRedirects } })
    {
        auto m = makeObject();
        for (const auto& [from, to] : *map)
            setProp (m, from, to);
        setProp (redirects, name, m);
    }
    setProp (o, "redirects", redirects);
    setProp (o, "creditsUrl", index.creditsUrl);
    return o;
}

juce::String categoryForRole (const juce::String& role)
{
    if (role == "kick" || role == "snare" || role == "clap" || role == "rim")
        return role;
    if (role.startsWith ("hat"))
        return "hat";
    if (role == "crash" || role == "ride" || role == "cymbal")
        return "cymbal";
    if (role == "tom" || role.startsWith ("tom-"))
        return "tom";
    if (role == "effects" || role == "fx" || role == "vocal")
        return "fx";
    return "percussion";
}

juce::String iconForRole (const juce::String& role)
{
    if (role == "kick" || role == "snare" || role == "clap" || role == "rim" || role == "hat-closed" || role == "hat-open")
        return role;
    const auto cat = categoryForRole (role);
    if (cat == "cymbal" || cat == "tom")
        return cat;
    return "percussion";
}
} // namespace drums
