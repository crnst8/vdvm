#include "Bridge.h"
#include "core/Json.h"
#include "core/Render.h"

#include <DrumsUiData.h>

namespace drums
{
namespace
{
    juce::var ok (const juce::var& value = {})
    {
        auto o = makeObject();
        setProp (o, "ok", true);
        setProp (o, "value", value);
        return o;
    }

    juce::var fail (const juce::String& message)
    {
        auto o = makeObject();
        setProp (o, "ok", false);
        setProp (o, "error", message);
        return o;
    }

    juce::String mimeFor (const juce::String& path)
    {
        const auto ext = path.fromLastOccurrenceOf (".", false, false).toLowerCase();
        if (ext == "html") return "text/html";
        if (ext == "js" || ext == "mjs") return "text/javascript";
        if (ext == "css") return "text/css";
        if (ext == "json") return "application/json";
        if (ext == "png") return "image/png";
        if (ext == "webp") return "image/webp";
        if (ext == "jpg" || ext == "jpeg") return "image/jpeg";
        if (ext == "svg") return "image/svg+xml";
        if (ext == "woff2") return "font/woff2";
        if (ext == "wav") return "audio/wav";
        return "application/octet-stream";
    }

    /** The UI bundle, unpacked once per process from the embedded zip. */
    const std::map<juce::String, juce::MemoryBlock>& uiFiles()
    {
        static const auto files = []
        {
            std::map<juce::String, juce::MemoryBlock> out;
            juce::MemoryInputStream zipStream (DrumsUi::ui_zip, DrumsUi::ui_zipSize, false);
            juce::ZipFile zip (zipStream);
            for (int i = 0; i < zip.getNumEntries(); ++i)
            {
                const auto* entry = zip.getEntry (i);
                if (entry->filename.endsWithChar ('/'))
                    continue;
                std::unique_ptr<juce::InputStream> in (zip.createStreamForEntry (i));
                if (in == nullptr)
                    continue;
                juce::MemoryBlock data;
                in->readIntoMemoryBlock (data);
                out[entry->filename.replaceCharacter ('\\', '/')] = std::move (data);
            }
            return out;
        }();
        return files;
    }

    juce::var sampleInfo (const ImportedSample& s, bool assigned)
    {
        auto o = makeObject();
        setProp (o, "sha", s.sha256);
        setProp (o, "name", s.name);
        setProp (o, "channels", s.channels);
        setProp (o, "sampleRate", s.sampleRate);
        setProp (o, "durationSec", s.durationSec);
        setProp (o, "suggestedRole", s.suggestedRole);
        setProp (o, "assigned", assigned);
        return o;
    }

    std::set<juce::String> assignedShas (const Library& lib)
    {
        std::set<juce::String> used;
        for (const auto& e : lib.index().kits)
        {
            juce::String error;
            if (const auto k = lib.loadKit (e.id, error))
                for (const auto& s : k->samples)
                    used.insert (s.blobSha256);
        }
        return used;
    }

    KitDraft draftFromJson (const juce::var& v)
    {
        KitDraft d;
        d.kitId = v["kitId"].toString();
        d.label = v["label"].toString();
        if (const auto* slots = v["slots"].getArray())
        {
            for (const auto& s : *slots)
            {
                SlotDraft sd;
                sd.id = s["id"].toString();
                sd.role = s["role"].toString();
                sd.label = s["label"].toString();
                if (const auto* shas = s["sampleShas"].getArray())
                    for (const auto& sha : *shas)
                        sd.sampleShas.add (sha.toString());
                sd.defaultSha = s["defaultSha"].toString();
                d.slots.push_back (sd);
            }
        }
        return d;
    }

    juce::var draftToJson (const KitManifest& kit)
    {
        auto o = makeObject();
        setProp (o, "kitId", kit.id);
        setProp (o, "label", kit.label);
        juce::Array<juce::var> slots;
        for (const auto& slot : kit.slots)
        {
            auto s = makeObject();
            setProp (s, "id", slot.id);
            setProp (s, "role", knownRoles().contains (slot.id) ? slot.id : juce::String());
            setProp (s, "label", slot.label);
            juce::Array<juce::var> shas;
            for (const auto& id : slot.sampleIds)
                if (const auto* smp = kit.sample (id))
                    shas.add (smp->blobSha256);
            setProp (s, "sampleShas", shas);
            const auto* def = kit.sample (slot.defaultSampleId);
            setProp (s, "defaultSha", def != nullptr ? def->blobSha256 : juce::String());
            slots.add (s);
        }
        setProp (o, "slots", slots);
        return o;
    }
} // namespace

Bridge::Bridge (DrumsProcessor& p) : proc (p)
{
    registerFunctions();
}

Bridge::~Bridge()
{
    *alive = false;
    cancelScan->store (true);
    proc.emit = nullptr;
}

juce::String Bridge::startUrl()
{
    const auto dev = juce::SystemStats::getEnvironmentVariable ("VDVM_UI_DEV_URL", {});
    return dev.isNotEmpty() ? dev : juce::WebBrowserComponent::getResourceProviderRoot();
}

void Bridge::attach (juce::WebBrowserComponent* b)
{
    browser = b;
    proc.emit = [this] (const juce::String& event, const juce::var& payload) { emit (event, payload); };
}

void Bridge::emit (const juce::String& event, const juce::var& payload)
{
    if (browser != nullptr)
        browser->emitEventIfBrowserIsVisible (juce::Identifier (event), payload);
}

void Bridge::add (const char* name, Handler h)
{
    handlers.emplace_back (name, std::move (h));
}

juce::WebBrowserComponent::Options Bridge::options (juce::WebBrowserComponent::Options base)
{
    auto o = base.withNativeIntegrationEnabled()
                 .withKeepPageLoadedWhenBrowserIsHidden()
                 .withResourceProvider ([this] (const juce::String& path) { return resource (path); },
                                        juce::SystemStats::getEnvironmentVariable ("VDVM_UI_DEV_URL", {}).isNotEmpty()
                                            ? std::optional<juce::String> (juce::URL (startUrl()).getOrigin())
                                            : std::nullopt);
    // VDVM_BRIDGE_LOG=<file> records every call (development and support).
    const auto logPath = juce::SystemStats::getEnvironmentVariable ("VDVM_BRIDGE_LOG", {});
    auto log = logPath.isNotEmpty() ? std::make_shared<juce::FileLogger> (juce::File (logPath), "V.D.V.M bridge") : nullptr;
    for (auto& [name, h] : handlers)
    {
        o = o.withNativeFunction (juce::Identifier (name), [handler = h, aliveFlag = alive, log, fn = name] (const juce::Array<juce::var>& args, Completion done)
        {
            if (! *aliveFlag)
                return;
            if (log != nullptr)
            {
                const auto arg = args.isEmpty() ? juce::String() : juce::JSON::toString (args[0], true);
                log->logMessage (fn + " " + arg.substring (0, 200));
                done = [log, fn, inner = std::move (done)] (juce::var result)
                {
                    log->logMessage ("  -> " + fn + " " + juce::JSON::toString (result, true).substring (0, 300));
                    inner (result);
                };
            }
            try
            {
                handler (args.isEmpty() ? juce::var() : args[0], std::move (done));
            }
            catch (const std::exception& e)
            {
                done (fail (e.what()));
            }
        });
    }
    return o;
}

std::optional<juce::WebBrowserComponent::Resource> Bridge::resource (const juce::String& rawPath)
{
    auto path = juce::URL::removeEscapeChars (rawPath.upToFirstOccurrenceOf ("?", false, false).upToFirstOccurrenceOf ("#", false, false));
    const auto make = [] (const void* data, size_t size, const juce::String& mime)
    {
        juce::WebBrowserComponent::Resource r;
        r.data.resize (size);
        std::memcpy (r.data.data(), data, size);
        r.mimeType = mime;
        return r;
    };
    if (path.startsWith ("/lib/"))
    {
        // /lib/<libraryId>/<catalog-relative path>: confined to that library's folder.
        const auto rest = path.substring (5);
        const auto id = rest.upToFirstOccurrenceOf ("/", false, false);
        const auto rel = rest.fromFirstOccurrenceOf ("/", false, false);
        juce::String error;
        const auto lib = proc.libraries().get (id, error);
        if (lib == nullptr)
            return std::nullopt;
        const auto file = lib->resourceFile (rel);
        juce::MemoryBlock data;
        if (! file || ! file->existsAsFile() || file->getSize() > 64 * 1024 * 1024 || ! file->loadFileAsData (data))
            return std::nullopt;
        return make (data.getData(), data.getSize(), mimeFor (rel));
    }
    if (path == "/" || path.isEmpty())
        path = "/index.html";
    const auto& files = uiFiles();
    const auto it = files.find (path.substring (1));
    if (it == files.end())
        return std::nullopt;
    return make (it->second.getData(), it->second.getSize(), mimeFor (path));
}

void Bridge::background (std::function<juce::var()> work, Completion done)
{
    auto aliveFlag = alive;
    juce::Thread::launch ([work = std::move (work), done = std::move (done), aliveFlag]() mutable
    {
        juce::var result;
        try
        {
            result = work();
        }
        catch (const std::exception& e)
        {
            result = fail (e.what());
        }
        juce::MessageManager::callAsync ([done = std::move (done), result, aliveFlag]
        {
            if (*aliveFlag)
                done (result);
        });
    });
}

void Bridge::chooseFile (const juce::String& title, const juce::String& patterns, int flags, std::function<void (juce::Array<juce::File>)> then)
{
    chooser = std::make_unique<juce::FileChooser> (title, juce::File(), patterns, true);
    auto aliveFlag = alive;
    chooser->launchAsync (flags, [then = std::move (then), aliveFlag] (const juce::FileChooser& fc)
    {
        if (*aliveFlag)
            then (fc.getResults());
    });
}

void Bridge::registerFunctions()
{
    // ---- boot and state ---------------------------------------------------------------
    add ("boot", [this] (const juce::var&, Completion done)
    {
        auto& s = proc.session();
        auto o = makeObject();
        setProp (o, "version", juce::String (DRUMS_VERSION));
        const auto libs = proc.librariesJson();
        setProp (o, "libraries", libs["libraries"]);
        setProp (o, "activeLibraryId", libs["activeLibraryId"]);
        setProp (o, "resourceRoot", juce::WebBrowserComponent::getResourceProviderRoot());
        if (s.pattern().kitId.isNotEmpty())
        {
            auto d = makeObject();
            setProp (d, "pattern", toPatternJson (s.pattern()));
            setProp (d, "saved", s.savedFlag());
            setProp (d, "selectedSlotId", s.selectedSlot().isNotEmpty() ? juce::var (s.selectedSlot()) : juce::var());
            setProp (o, "draft", d);
        }
        else
        {
            setProp (o, "draft", juce::var());
        }
        setProp (o, "status", proc.statusJson());
        auto prefs = proc.prefs().get();
        setProp (prefs, "outputDb", (double) proc.parameters().getRawParameterValue ("output")->load());
        setProp (o, "prefs", prefs);
        juce::Array<juce::var> roles;
        for (const auto& r : knownRoles())
        {
            auto ro = makeObject();
            setProp (ro, "id", r);
            setProp (ro, "label", labelForRole (r));
            roles.add (ro);
        }
        setProp (o, "roles", roles);
        setProp (o, "view", getView ? getView() : juce::var());
        done (ok (o));
    });
    add ("setPattern", [this] (const juce::var& arg, Completion done)
    {
        auto p = fromPatternJson (arg);
        if (! p)
            return done (fail ("Not a pattern."));
        proc.applyPatternFromUi (*p);
        done (ok());
    });
    add ("saveDraft", [this] (const juce::var& arg, Completion done)
    {
        if (auto p = fromPatternJson (arg["pattern"]))
            proc.applyPatternFromUi (*p);
        proc.session().setDraftMeta (arg["saved"].isBool() && (bool) arg["saved"], arg["selectedSlotId"].toString());
        done (ok());
    });
    add ("selectKit", [this] (const juce::var& arg, Completion done)
    {
        const auto libraryId = arg["libraryId"].toString();
        proc.session().selectKit (libraryId, arg["kitId"].toString(), [this, done, libraryId] (bool success, const juce::String& error)
        {
            if (success)
            {
                proc.setBrowseLibrary (libraryId);
                auto patch = makeObject();
                setProp (patch, "lastKitId", proc.session().kit()->id);
                proc.prefs().merge (patch);
            }
            done (success ? ok (error) : fail (error));
        });
    });
    add ("prepareSample", [this] (const juce::var& arg, Completion done)
    {
        proc.session().prepareSample (arg["sampleId"].toString(), [done] (bool success, const juce::String& error)
        {
            done (success ? ok() : fail (error));
        });
    });
    add ("audition", [this] (const juce::var& arg, Completion done)
    {
        proc.audition (arg["slotId"].toString(), (int) arg["step"]);
        done (ok());
    });
    add ("transport", [this] (const juce::var& arg, Completion done)
    {
        proc.transportCommand (arg.toString());
        done (ok());
    });
    add ("setOutputDb", [this] (const juce::var& arg, Completion done)
    {
        proc.setOutputDb ((double) arg);
        done (ok());
    });
    add ("setHostSync", [this] (const juce::var& arg, Completion done)
    {
        proc.setHostSync ((bool) arg);
        done (ok());
    });
    add ("setPrefs", [this] (const juce::var& arg, Completion done)
    {
        // Output volume is a host parameter in the plugin, saved with the project.
        if (arg.hasProperty ("outputDb"))
            proc.setOutputDb ((double) arg["outputDb"]);
        proc.prefs().merge (arg);
        done (ok());
    });

    add ("setView", [this] (const juce::var& arg, Completion done)
    {
        done (onSetView ? ok (onSetView (arg)) : fail ("No window."));
    });
    add ("log", [] (const juce::var& arg, Completion done)
    {
        // UI errors go to a small log beside the user's libraries, for support.
        const auto file = LibraryManager::defaultDataDir().getChildFile ("Logs/ui.log");
        file.getParentDirectory().createDirectory();
        if (file.getSize() > 512 * 1024)
            file.moveFileTo (file.withFileExtension ("old.log"));
        file.appendText (juce::Time::getCurrentTime().toISO8601 (true) + " " + arg.toString().substring (0, 2000) + "\n");
        done (ok());
    });

    // ---- saved patterns -------------------------------------------------------------------
    add ("listPatterns", [this] (const juce::var&, Completion done) { done (ok (proc.patterns().list())); });
    add ("putPattern", [this] (const juce::var& arg, Completion done)
    {
        done (proc.patterns().put (arg) ? ok() : fail ("Could not save the pattern."));
    });
    add ("deletePattern", [this] (const juce::var& arg, Completion done)
    {
        done (proc.patterns().remove (arg.toString()) ? ok() : fail ("Could not delete the pattern."));
    });

    // ---- files and exports -----------------------------------------------------------------
    add ("saveText", [this] (const juce::var& arg, Completion done)
    {
        const auto text = arg["text"].toString();
        const auto name = juce::File::createLegalFileName (arg["name"].toString());
        chooser = std::make_unique<juce::FileChooser> ("Save", juce::File::getSpecialLocation (juce::File::userDocumentsDirectory).getChildFile (name),
                                                       "*" + juce::File (name).getFileExtension(), true);
        auto aliveFlag = alive;
        chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting,
                              [done, text, aliveFlag] (const juce::FileChooser& fc)
        {
            if (! *aliveFlag)
                return;
            const auto f = fc.getResult();
            if (f == juce::File())
                return done (ok (false));
            done (writeFileAtomic (f, text) ? ok (true) : fail ("Could not write " + f.getFullPathName()));
        });
    });
    const auto exportWith = [this] (const juce::var& arg, Completion done, bool wav)
    {
        auto p = fromPatternJson (arg["pattern"]);
        const auto& kit = proc.session().kit();
        const auto lib = proc.session().library();
        if (! p || ! kit || ! lib || kit->id != arg["kitId"].toString())
            return done (fail ("The kit is not ready for export."));
        auto pattern = bindKit (*p, *kit);
        const auto name = juce::File::createLegalFileName (arg["name"].toString().isNotEmpty() ? arg["name"].toString() : juce::String ("V.D.V.M"));
        const auto save = [this, done, name, wav] (juce::MemoryBlock bytes)
        {
            chooser = std::make_unique<juce::FileChooser> (wav ? "Export audio" : "Export MIDI",
                                                           juce::File::getSpecialLocation (juce::File::userDocumentsDirectory)
                                                               .getChildFile (name + (wav ? ".wav" : ".mid")),
                                                           wav ? "*.wav" : "*.mid", true);
            auto aliveFlag = alive;
            chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting,
                                  [done, bytes, aliveFlag] (const juce::FileChooser& fc)
            {
                if (! *aliveFlag)
                    return;
                const auto f = fc.getResult();
                if (f == juce::File())
                    return done (ok (false));
                done (writeFileAtomic (f, bytes) ? ok (true) : fail ("Could not write " + f.getFullPathName()));
            });
        };
        if (! wav)
            return save (midiFileBytes (pattern, *kit, proc.session().midiMap()));
        auto kitCopy = *kit;
        auto aliveFlag = alive;
        juce::Thread::launch ([pattern, kitCopy, lib, save, done, aliveFlag]
        {
            juce::String error;
            const auto audio = renderLoop (pattern, kitCopy, [lib] (const Sample& s)
            {
                const auto f = lib->sampleFile (s);
                if (! f)
                {
                    Decoded d;
                    d.error = "file missing";
                    return d;
                }
                return decodeAudioFile (*f, s.blobSha256);
            }, error);
            auto bytes = error.isEmpty() ? wavBytes (audio, exportSampleRate) : juce::MemoryBlock();
            juce::MessageManager::callAsync ([save, done, bytes, error, aliveFlag]
            {
                if (! *aliveFlag)
                    return;
                if (error.isNotEmpty())
                    return done (fail (error));
                save (bytes);
            });
        });
    };
    add ("exportWav", [exportWith] (const juce::var& arg, Completion done) { exportWith (arg, std::move (done), true); });
    add ("exportMidi", [exportWith] (const juce::var& arg, Completion done) { exportWith (arg, std::move (done), false); });
    add ("savePreset", [this] (const juce::var&, Completion done)
    {
        const auto& p = proc.session().pattern();
        const auto preset = proc.session().toPresetJson();
        chooser = std::make_unique<juce::FileChooser> ("Save preset",
                                                       LibraryManager::defaultDataDir().getChildFile ("Presets").getChildFile (juce::File::createLegalFileName (p.name) + ".vdvmpreset"),
                                                       "*.vdvmpreset", true);
        LibraryManager::defaultDataDir().getChildFile ("Presets").createDirectory();
        auto aliveFlag = alive;
        chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting,
                              [done, preset, aliveFlag] (const juce::FileChooser& fc)
        {
            if (! *aliveFlag)
                return;
            const auto f = fc.getResult();
            if (f == juce::File())
                return done (ok (false));
            done (writeFileAtomic (f.withFileExtension ("vdvmpreset"), stableJson (preset)) ? ok (true) : fail ("Could not write the preset."));
        });
    });
    add ("loadPreset", [this] (const juce::var&, Completion done)
    {
        // .drumspreset: presets saved before the product was named V.D.V.M.
        chooseFile ("Load preset", "*.vdvmpreset;*.drumspreset", juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
                    [this, done] (juce::Array<juce::File> files)
        {
            if (files.isEmpty())
                return done (ok (false));
            juce::String error;
            const auto json = parseJson (files[0].loadFileAsString(), error);
            if (! json)
                return done (fail ("This file is not a V.D.V.M preset."));
            if (! proc.session().loadPresetJson (*json, error, [this] (bool, const juce::String&) { proc.emitExternalChange(); }))
                return done (fail (error));
            done (ok (true));
        });
    });

    // ---- libraries ----------------------------------------------------------------------------
    const auto librariesChanged = [this] { emit ("drums:libraries", proc.librariesJson()); };
    add ("useLibrary", [this] (const juce::var& arg, Completion done)
    {
        juce::String error;
        if (proc.libraries().get (arg.toString(), error) == nullptr)
            return done (fail (error));
        proc.setBrowseLibrary (arg.toString());
        done (ok());
    });
    add ("addCatalog", [this, librariesChanged] (const juce::var&, Completion done)
    {
        chooseFile ("Choose a V.D.V.M catalog folder", {}, juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories,
                    [this, done, librariesChanged] (juce::Array<juce::File> files)
        {
            if (files.isEmpty())
                return done (ok (juce::var()));
            juce::String error;
            const auto id = proc.libraries().addCatalog (files[0], error);
            if (id.isEmpty())
                return done (fail (error));
            librariesChanged();
            done (ok (id));
        });
    });
    add ("createLibrary", [this, librariesChanged] (const juce::var& arg, Completion done)
    {
        juce::String error;
        const auto id = proc.libraries().createUserLibrary (arg.toString(), error);
        if (id.isEmpty())
            return done (fail (error));
        librariesChanged();
        done (ok (id));
    });
    add ("linkFolder", [this, librariesChanged] (const juce::var&, Completion done)
    {
        chooseFile ("Choose a folder of samples to link", {}, juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories,
                    [this, done, librariesChanged] (juce::Array<juce::File> files)
        {
            if (files.isEmpty())
                return done (ok (juce::var()));
            juce::String error;
            const auto id = proc.libraries().createLinkedLibrary (files[0].getFileName(), files[0], error);
            if (id.isEmpty())
                return done (fail (error));
            librariesChanged();
            done (ok (id));
        });
    });
    add ("removeLibrary", [this, librariesChanged] (const juce::var& arg, Completion done)
    {
        juce::String error;
        if (! proc.libraries().remove (arg.toString(), error))
            return done (fail (error));
        librariesChanged();
        done (ok());
    });
    add ("renameLibrary", [this, librariesChanged] (const juce::var& arg, Completion done)
    {
        juce::String error;
        if (! proc.libraries().rename (arg["id"].toString(), arg["name"].toString(), error))
            return done (fail (error));
        librariesChanged();
        done (ok());
    });
    add ("relocateLibrary", [this, librariesChanged] (const juce::var& arg, Completion done)
    {
        const auto id = arg.toString();
        const auto rec = proc.libraries().record (id);
        if (! rec)
            return done (fail ("No such library."));
        chooseFile (rec->kind == LibraryKind::linked ? "Locate the linked sample folder" : "Locate the library folder", {},
                    juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories,
                    [this, done, id, kind = rec->kind, librariesChanged] (juce::Array<juce::File> files)
        {
            if (files.isEmpty())
                return done (ok (juce::var()));
            const auto folder = files[0];
            if (kind != LibraryKind::linked)
            {
                juce::String error;
                if (! proc.libraries().relocate (id, folder, error))
                    return done (fail (error));
                librariesChanged();
                return done (ok (juce::var()));
            }
            background ([this, id, folder]
            {
                std::lock_guard lock (proc.libraryWrites());
                juce::String error;
                const auto r = relinkLibrary (proc.libraries(), id, folder, error);
                if (error.isNotEmpty())
                    return fail (error);
                auto o = makeObject();
                setProp (o, "found", r.found);
                setProp (o, "missing", r.missing);
                juce::Array<juce::var> names;
                for (const auto& n : r.missingNames)
                    names.add (n);
                setProp (o, "missingNames", names);
                return ok (o);
            }, [this, done, librariesChanged] (const juce::var& result)
            {
                librariesChanged();
                if (proc.session().kit())
                    proc.session().reloadActiveKit();
                done (result);
            });
        });
    });
    add ("checkLibrary", [this] (const juce::var& arg, Completion done)
    {
        const auto id = arg.toString();
        background ([this, id]
        {
            const auto h = checkLibrary (proc.libraries(), id);
            auto o = makeObject();
            setProp (o, "kits", h.kits);
            setProp (o, "samples", h.samples);
            setProp (o, "missing", h.missing);
            setProp (o, "changed", h.changed);
            juce::Array<juce::var> problems;
            for (const auto& p : h.problems)
                problems.add (p);
            setProp (o, "problems", problems);
            return ok (o);
        }, std::move (done));
    });
    add ("revealLibrary", [this] (const juce::var& arg, Completion done)
    {
        if (const auto rec = proc.libraries().record (arg.toString()))
            (rec->kind == LibraryKind::linked ? rec->linkedRoot : rec->root).revealToUser();
        done (ok());
    });
    add ("retryMissing", [this] (const juce::var&, Completion done)
    {
        proc.libraries().refresh();
        proc.session().retryMissing ([this, done] (bool success, const juce::String& error)
        {
            if (success)
                proc.emitExternalChange();
            done (success ? ok() : fail (error));
        });
    });
    add ("findKit", [this] (const juce::var& arg, Completion done)
    {
        const auto found = proc.libraries().findKit ({}, arg["kitId"].toString(), arg["revision"].toString());
        done (ok (found ? juce::var (found->libraryId) : juce::var()));
    });

    // ---- import -------------------------------------------------------------------------------
    add ("chooseAudio", [this] (const juce::var& arg, Completion done)
    {
        const bool folder = arg.toString() == "folder";
        const int flags = juce::FileBrowserComponent::openMode
                          | (folder ? juce::FileBrowserComponent::canSelectDirectories
                                    : juce::FileBrowserComponent::canSelectFiles | juce::FileBrowserComponent::canSelectMultipleItems);
        chooseFile (folder ? "Choose a folder of samples" : "Choose samples", folder ? juce::String() : "*.wav;*.wave;*.aif;*.aiff;*.aifc;*.flac", flags,
                    [this, done] (juce::Array<juce::File> files)
        {
            if (files.isEmpty())
                return done (ok (juce::var()));
            cancelScan->store (false);
            auto cancel = cancelScan;
            auto aliveFlag = alive;
            juce::Thread::launch ([this, files, cancel, aliveFlag, done]
            {
                auto result = std::make_shared<ScanResult> (scanForAudio (files, {}, cancel.get(), [this, aliveFlag] (int examined, int found)
                {
                    juce::MessageManager::callAsync ([this, aliveFlag, examined, found]
                    {
                        if (! *aliveFlag)
                            return;
                        auto o = makeObject();
                        setProp (o, "examined", examined);
                        setProp (o, "found", found);
                        emit ("drums:scan", o);
                    });
                }));
                juce::MessageManager::callAsync ([this, result, aliveFlag, done]
                {
                    if (! *aliveFlag)
                        return;
                    if (result->cancelled)
                        return done (ok (juce::var()));
                    const int id = nextScanId++;
                    scans[id] = *result;
                    auto o = makeObject();
                    setProp (o, "scanId", id);
                    setProp (o, "folder", result->folder != juce::File() ? juce::var (result->folder.getFullPathName()) : juce::var());
                    juce::Array<juce::var> candidates, rejected;
                    for (int i = 0; i < (int) result->candidates.size(); ++i)
                    {
                        const auto& c = result->candidates[(size_t) i];
                        auto co = makeObject();
                        setProp (co, "index", i);
                        setProp (co, "name", c.name);
                        setProp (co, "relPath", c.relPath);
                        setProp (co, "format", c.format);
                        setProp (co, "channels", c.channels);
                        setProp (co, "sampleRate", c.sampleRate);
                        setProp (co, "durationSec", c.durationSec);
                        setProp (co, "bytes", (juce::int64) c.bytes);
                        setProp (co, "suggestedRole", c.suggestedRole);
                        candidates.add (co);
                    }
                    for (const auto& r : result->rejected)
                    {
                        auto ro = makeObject();
                        setProp (ro, "name", r.file.getFileName());
                        setProp (ro, "reason", r.reason);
                        rejected.add (ro);
                    }
                    setProp (o, "candidates", candidates);
                    setProp (o, "rejected", rejected);
                    setProp (o, "rejectedTotal", result->rejectedTotal);
                    setProp (o, "truncated", result->truncated);
                    done (ok (o));
                });
            });
        });
    });
    add ("cancelScan", [this] (const juce::var&, Completion done)
    {
        cancelScan->store (true);
        done (ok());
    });
    add ("importScan", [this, librariesChanged] (const juce::var& arg, Completion done)
    {
        const auto it = scans.find ((int) arg["scanId"]);
        if (it == scans.end())
            return done (fail ("That scan is no longer available; choose the files again."));
        std::vector<ScanCandidate> picked;
        if (const auto* indices = arg["indices"].getArray())
            for (const auto& i : *indices)
                if ((int) i >= 0 && (int) i < (int) it->second.candidates.size())
                    picked.push_back (it->second.candidates[(size_t) (int) i]);
        const auto libraryId = arg["libraryId"].toString();
        scans.erase (it);
        background ([this, picked, libraryId]
        {
            std::lock_guard lock (proc.libraryWrites());
            const auto outcome = importSamples (proc.libraries(), libraryId, picked);
            juce::String error;
            const auto lib = proc.libraries().get (libraryId, error);
            const auto used = lib ? assignedShas (*lib) : std::set<juce::String>();
            auto o = makeObject();
            juce::Array<juce::var> imported, failed;
            for (const auto& s : outcome.imported)
                imported.add (sampleInfo (s, used.count (s.sha256) > 0));
            for (const auto& f : outcome.failed)
            {
                auto fo = makeObject();
                setProp (fo, "name", f.file.getFileName());
                setProp (fo, "reason", f.reason);
                failed.add (fo);
            }
            setProp (o, "imported", imported);
            setProp (o, "failed", failed);
            return ok (o);
        }, [done, librariesChanged] (const juce::var& result)
        {
            librariesChanged();
            done (result);
        });
    });
    add ("librarySamples", [this] (const juce::var& arg, Completion done)
    {
        juce::String error;
        const auto lib = proc.libraries().get (arg.toString(), error);
        if (! lib)
            return done (fail (error));
        const auto used = assignedShas (*lib);
        juce::Array<juce::var> list;
        for (const auto& [sha, s] : lib->imported())
            list.add (sampleInfo (s, used.count (sha) > 0));
        done (ok (list));
    });
    add ("libraryKits", [this] (const juce::var& arg, Completion done)
    {
        juce::String error;
        const auto lib = proc.libraries().get (arg.toString(), error);
        if (! lib)
            return done (fail (error));
        juce::Array<juce::var> list;
        for (const auto& k : lib->index().kits)
        {
            auto o = makeObject();
            setProp (o, "id", k.id);
            setProp (o, "label", k.label);
            list.add (o);
        }
        done (ok (list));
    });
    add ("removeSamples", [this, librariesChanged] (const juce::var& arg, Completion done)
    {
        juce::StringArray shas;
        if (const auto* a = arg["shas"].getArray())
            for (const auto& s : *a)
                shas.add (s.toString());
        std::lock_guard lock (proc.libraryWrites());
        juce::String error;
        const int n = removeUnusedSamples (proc.libraries(), arg["libraryId"].toString(), shas, error);
        librariesChanged();
        done (error.isEmpty() ? ok (n) : fail (error));
    });
    add ("previewSample", [this] (const juce::var& arg, Completion done)
    {
        juce::String error;
        const auto lib = proc.libraries().get (arg["libraryId"].toString(), error);
        if (! lib)
            return done (fail (error));
        const auto sha = arg["sha"].toString();
        Sample s;
        s.blobSha256 = sha;
        s.url = "media/audio/" + sha + ".wav";
        auto file = lib->sampleFile (s);
        if ((! file || ! file->existsAsFile()) && lib->record().kind == LibraryKind::user)
            file = lib->resourceFile ("pool/" + sha + ".wav");
        if (! file || ! file->existsAsFile())
            return done (fail ("That sound's file is missing."));
        auto& store = proc.sampleStore();
        background ([&store, sha, f = *file]
        {
            juce::String loadError;
            auto data = store.loadNow ({ sha, f }, loadError);
            if (! data)
                return fail (loadError);
            // Hand the pointer over as an opaque handle; the message thread takes ownership below.
            auto o = makeObject();
            setProp (o, "sha", sha);
            return ok (o);
        }, [this, sha, done] (const juce::var& result)
        {
            if ((bool) result["ok"])
                proc.preview (proc.sampleStore().get (sha));
            done (result);
        });
    });
    add ("kitDraft", [this] (const juce::var& arg, Completion done)
    {
        juce::String error;
        const auto lib = proc.libraries().get (arg["libraryId"].toString(), error);
        const auto kit = lib ? lib->loadKit (arg["kitId"].toString(), error) : std::nullopt;
        if (! kit)
            return done (fail (error));
        done (ok (draftToJson (*kit)));
    });
    add ("saveKit", [this, librariesChanged] (const juce::var& arg, Completion done)
    {
        const auto libraryId = arg["libraryId"].toString();
        const auto draft = draftFromJson (arg["draft"]);
        background ([this, libraryId, draft]
        {
            std::lock_guard lock (proc.libraryWrites());
            juce::String error;
            const auto id = saveKit (proc.libraries(), libraryId, draft, error);
            return id.isEmpty() ? fail (error) : ok (id);
        }, [done, librariesChanged] (const juce::var& result)
        {
            librariesChanged();
            done (result);
        });
    });
    add ("deleteKit", [this, librariesChanged] (const juce::var& arg, Completion done)
    {
        const auto libraryId = arg["libraryId"].toString();
        const auto kitId = arg["kitId"].toString();
        if (proc.session().kit() && proc.session().kit()->id == kitId && proc.session().reference().libraryId == libraryId)
            return done (fail ("This kit is playing. Choose another kit first."));
        std::lock_guard lock (proc.libraryWrites());
        juce::String error;
        if (! deleteKit (proc.libraries(), libraryId, kitId, error))
            return done (fail (error));
        librariesChanged();
        done (ok());
    });
    add ("copyKit", [this, librariesChanged] (const juce::var& arg, Completion done)
    {
        const auto from = arg["fromLibraryId"].toString();
        const auto kitId = arg["kitId"].toString();
        const auto to = arg["toLibraryId"].toString();
        background ([this, from, kitId, to]
        {
            std::lock_guard lock (proc.libraryWrites());
            juce::String error;
            const auto id = copyKit (proc.libraries(), from, kitId, to, error);
            return id.isEmpty() ? fail (error) : ok (id);
        }, [done, librariesChanged] (const juce::var& result)
        {
            librariesChanged();
            done (result);
        });
    });

    // ---- MIDI notes ------------------------------------------------------------------------------
    add ("midiMap", [this] (const juce::var&, Completion done)
    {
        const auto& kit = proc.session().kit();
        juce::Array<juce::var> list;
        if (kit)
        {
            const auto map = proc.session().midiMap();
            const auto& overrides = proc.session().midiOverridesForKit();
            for (const auto& slot : kit->slots)
            {
                auto o = makeObject();
                const int note = map.noteFor (slot.id);
                setProp (o, "slotId", slot.id);
                setProp (o, "label", slot.label);
                setProp (o, "note", note);
                setProp (o, "name", midiNoteName (note));
                setProp (o, "overridden", overrides.count (slot.id) > 0);
                list.add (o);
            }
        }
        done (ok (list));
    });
    add ("setMidiNote", [this] (const juce::var& arg, Completion done)
    {
        proc.session().setMidiNote (arg["slotId"].toString(), (int) arg["note"]);
        done (ok());
    });
    add ("resetMidiMap", [this] (const juce::var&, Completion done)
    {
        proc.session().resetMidiMap();
        done (ok());
    });
}
} // namespace drums
