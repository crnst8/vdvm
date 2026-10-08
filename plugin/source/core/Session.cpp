#include "Session.h"
#include "Json.h"

namespace drums
{
juce::var KitReference::toJson() const
{
    auto o = makeObject();
    setProp (o, "libraryId", libraryId);
    setProp (o, "libraryKind", libraryKind);
    setProp (o, "libraryName", libraryName);
    setProp (o, "pathHint", pathHint);
    setProp (o, "kitId", kitId);
    setProp (o, "kitRevision", kitRevision);
    setProp (o, "kitLabel", kitLabel);
    setProp (o, "machineName", machineName);
    return o;
}

KitReference KitReference::fromJson (const juce::var& v)
{
    KitReference r;
    r.libraryId = v["libraryId"].toString();
    r.libraryKind = v["libraryKind"].toString();
    r.libraryName = v["libraryName"].toString();
    r.pathHint = v["pathHint"].toString();
    r.kitId = v["kitId"].toString();
    r.kitRevision = v["kitRevision"].toString();
    r.kitLabel = v["kitLabel"].toString();
    r.machineName = v["machineName"].toString();
    return r;
}

juce::String toString (KitStatus s)
{
    switch (s)
    {
        case KitStatus::idle: return "idle";
        case KitStatus::loading: return "loading";
        case KitStatus::ready: return "ready";
        case KitStatus::error: return "error";
        case KitStatus::missing: return "missing";
    }
    return "idle";
}

namespace
{
    const Sample* chosenFor (const KitManifest& kit, const Slot& slot, const PatternState& p)
    {
        juce::String want = slot.defaultSampleId;
        if (p.kitId == kit.id)
            if (const auto it = p.tracks.find (slot.id); it != p.tracks.end())
                want = it->second.sampleId;
        return slot.sampleIds.contains (want) ? kit.sample (want) : nullptr;
    }

    /** Follow sample redirects of the kit's catalog so saved patterns survive identity merges. */
    PatternState resolveSampleIds (PatternState p, const CatalogIndex& index)
    {
        for (auto& [_, t] : p.tracks)
            t.sampleId = index.resolveSampleId (t.sampleId);
        return p;
    }
} // namespace

Session::Session (LibraryManager& l, SampleStore& s, Instrument& i, Post p)
    : libraries (l), store (s), instrument (i), post (std::move (p))
{
}

Session::~Session()
{
    *alive = false;
}

MidiMap Session::midiMap() const
{
    if (! activeKit)
        return {};
    return buildMidiMap (*activeKit, midiOverridesForKit());
}

const MidiOverrides& Session::midiOverridesForKit() const
{
    static const MidiOverrides none;
    if (! activeKit)
        return none;
    const auto it = midiOverrides.find (activeKit->id);
    return it == midiOverrides.end() ? none : it->second;
}

void Session::notify()
{
    for (auto& l : listeners)
        l();
}

void Session::setStatus (KitStatus s, const juce::String& error)
{
    kitStatus = s;
    lastError = error;
}

void Session::publish (bool atBar)
{
    if (! activeKit)
    {
        instrument.snapshots().publish (nullptr);
        return;
    }
    auto snapshot = buildSnapshot (pat, *activeKit, kitTag, midiMap(), [this] (const Sample& s) { return store.get (s.blobSha256); }, atBar);
    instrument.snapshots().publish (std::move (snapshot));
}

void Session::setPattern (const PatternState& p, bool notifyListeners)
{
    pat = p;
    // A kit change still waiting for the bar keeps waiting.
    publish (instrument.playing.load() && instrument.committedKitTag.load() != kitTag);
    if (notifyListeners)
        notify();
}

void Session::setDraftMeta (bool savedNow, const juce::String& selected)
{
    saved = savedNow;
    selectedSlotId = selected;
}

void Session::setMidiNote (const juce::String& slotId, int note)
{
    if (! activeKit)
        return;
    auto& o = midiOverrides[activeKit->id];
    if (note < 0 || note > 127)
        o.erase (slotId);
    else
    {
        // The note moves to this slot: drop any other override holding it.
        for (auto it = o.begin(); it != o.end();)
            it = it->second == note && it->first != slotId ? o.erase (it) : std::next (it);
        o[slotId] = note;
    }
    publish (instrument.playing.load() && instrument.committedKitTag.load() != kitTag);
    notify();
}

void Session::resetMidiMap()
{
    if (! activeKit)
        return;
    midiOverrides.erase (activeKit->id);
    publish (instrument.playing.load() && instrument.committedKitTag.load() != kitTag);
    notify();
}

LoadRequest Session::requestFor (const Library& lib, const Sample& s) const
{
    LoadRequest r;
    r.sha256 = s.blobSha256;
    r.file = lib.sampleFile (s).value_or (juce::File());
    r.verifyHash = true;
    r.estimatedDurationSec = s.durationSec;
    r.estimatedChannels = s.channels;
    return r;
}

void Session::selectKit (const juce::String& libraryId, const juce::String& kitId, Completion done)
{
    // Already playing this kit (same library and revision) and nothing pending: nothing to load.
    if (activeKit && activeLibrary && activeLibrary->record().id == libraryId && kitStatus == KitStatus::ready && pendingKit.isEmpty())
    {
        juce::String ignored;
        if (const auto current = libraries.get (libraryId, ignored))
        {
            if (const auto* e = current->index().kitEntry (kitId); e != nullptr && e->id == activeKit->id && e->revision == activeKit->revision)
            {
                if (done)
                    done (true, {});
                return;
            }
        }
    }
    ++generation;
    juce::String error;
    auto lib = libraries.get (libraryId, error);
    std::optional<KitManifest> kit;
    if (lib)
        kit = lib->loadKit (kitId, error);
    if (! kit)
    {
        // The current kit stays; only the request failed.
        setStatus (activeKit ? KitStatus::ready : KitStatus::error, error);
        pendingKit = {};
        notify();
        if (done)
            done (false, error);
        return;
    }
    startLoad (lib, *kit, std::nullopt, std::move (done));
}

void Session::startLoad (std::shared_ptr<Library> lib, KitManifest kit, std::optional<PatternState> withPattern, Completion done)
{
    const auto gen = generation;
    const auto& forChoice = withPattern ? *withPattern : pat;
    std::vector<LoadRequest> requests;
    juce::StringArray missing;
    std::set<juce::String> seen;
    for (const auto& slot : kit.slots)
    {
        const auto* s = chosenFor (kit, slot, forChoice);
        if (s == nullptr || ! seen.insert (s->blobSha256).second)
            continue;
        auto r = requestFor (*lib, *s);
        if (r.file == juce::File())
            missing.add (slot.label);
        else
            requests.push_back (r);
    }
    pendingKit = kit.id;
    progressDone = 0;
    progressTotal = (int) requests.size();
    setStatus (KitStatus::loading);
    notify();
    ++*loadsInFlight;
    auto aliveFlag = alive;
    auto inFlight = loadsInFlight;
    const auto total = requests.size();
    store.unpin ("staging");
    store.loadSet ("staging", std::move (requests),
        [this, aliveFlag, gen] (int doneCount, int totalCount)
        {
            post ([this, aliveFlag, gen, doneCount, totalCount]
            {
                if (! *aliveFlag || gen != generation)
                    return;
                progressDone = doneCount;
                progressTotal = totalCount;
                notify();
            });
        },
        [this, aliveFlag, inFlight, gen, lib, kit, withPattern, done, missing, total] (const juce::StringArray& errors)
        {
            post ([this, aliveFlag, inFlight, gen, lib, kit, withPattern, done, missing, total, errors]
            {
                // In flight until the new state is published, so offline renders can wait for it.
                struct Release
                {
                    std::shared_ptr<std::atomic<int>> n;
                    ~Release() { --*n; }
                } release { inFlight };
                if (! *aliveFlag)
                    return;
                if (gen != generation)
                {
                    if (done)
                        done (false, "superseded");
                    return;
                }
                pendingKit = {};
                const bool nothingLoaded = total > 0 && errors.size() >= (int) total;
                if (nothingLoaded || (total == 0 && ! missing.isEmpty() && missing.size() == (int) kit.slots.size()))
                {
                    store.unpin ("staging");
                    const auto message = "Could not load " + kit.label + ": " + (errors.isEmpty() ? "its sounds are missing" : errors[0]);
                    setStatus (activeKit ? KitStatus::ready : KitStatus::error, message);
                    notify();
                    if (done)
                        done (false, message);
                    return;
                }
                store.unpin ("active");
                store.movePin ("staging", "active");
                if (withPattern)
                    pat = *withPattern;
                pat = bindKit (resolveSampleIds (pat, lib->index()), kit);
                if (pat.id.isEmpty())
                    pat.id = newPatternId();
                activeKit = kit;
                activeLibrary = lib;
                kitTag = nextKitTag++;
                ref.libraryId = lib->record().id;
                ref.libraryKind = toString (lib->record().kind);
                ref.libraryName = lib->record().name;
                ref.pathHint = (lib->record().kind == LibraryKind::linked ? lib->record().linkedRoot : lib->record().root).getFullPathName();
                ref.kitId = kit.id;
                ref.kitRevision = kit.revision;
                ref.kitLabel = kit.label;
                const auto* machine = lib->index().machine (kit.machineId);
                ref.machineName = machine != nullptr ? machine->displayName : juce::String();
                if (! kit.slots.empty() && kit.slot (selectedSlotId) == nullptr)
                    selectedSlotId = kit.slots.front().id;
                juce::String warning;
                if (! missing.isEmpty() || ! errors.isEmpty())
                {
                    juce::StringArray parts;
                    if (! missing.isEmpty())
                        parts.add ("missing: " + missing.joinIntoString (", "));
                    parts.addArray (errors);
                    warning = "Some sounds of " + kit.label + " are silent (" + parts.joinIntoString ("; ") + ").";
                }
                setStatus (KitStatus::ready, warning);
                publish (instrument.playing.load());
                notify();
                if (done)
                    done (true, warning);
            });
        });
}

void Session::prepareSample (const juce::String& sampleId, Completion done)
{
    if (! activeKit || ! activeLibrary)
    {
        if (done)
            done (false, "No kit is loaded.");
        return;
    }
    const auto* s = activeKit->sample (sampleId);
    if (s == nullptr)
    {
        if (done)
            done (false, "That sound is not in this kit.");
        return;
    }
    auto request = requestFor (*activeLibrary, *s);
    if (request.file == juce::File())
    {
        if (done)
            done (false, "That sound's file is missing.");
        return;
    }
    const auto pin = "prep:" + s->blobSha256;
    const auto sha = s->blobSha256;
    auto aliveFlag = alive;
    store.loadSet (pin, { request }, nullptr, [this, aliveFlag, pin, sha, done] (const juce::StringArray& errors)
    {
        post ([this, aliveFlag, pin, sha, done, errors]
        {
            if (! *aliveFlag)
                return;
            store.addToPin ("active", sha);
            store.unpin (pin);
            if (errors.isEmpty())
                publish (instrument.playing.load() && instrument.committedKitTag.load() != kitTag);
            if (done)
                done (errors.isEmpty(), errors.isEmpty() ? juce::String() : errors[0]);
        });
    });
}

bool Session::isSampleReady (const juce::String& sampleId) const
{
    if (! activeKit)
        return false;
    const auto* s = activeKit->sample (sampleId);
    return s != nullptr && store.has (s->blobSha256);
}

void Session::reloadActiveKit (Completion done)
{
    if (ref.empty())
    {
        if (done)
            done (false, "No kit to reload.");
        return;
    }
    libraries.invalidate (ref.libraryId);
    ++generation;
    juce::String error;
    auto lib = libraries.get (ref.libraryId, error);
    std::optional<KitManifest> kit;
    if (lib)
        kit = lib->loadKit (ref.kitId, error);
    if (! kit)
    {
        setStatus (KitStatus::missing, error);
        notify();
        if (done)
            done (false, error);
        return;
    }
    startLoad (lib, *kit, std::nullopt, std::move (done));
}

juce::var Session::toStateJson() const
{
    auto o = makeObject();
    setProp (o, "format", stateFormat);
    setProp (o, "version", 1);
    if (pat.kitId.isNotEmpty())
        setProp (o, "pattern", toPatternJson (pat));
    setProp (o, "saved", saved);
    setProp (o, "selectedSlotId", selectedSlotId);
    setProp (o, "library", ref.toJson());
    auto overrides = makeObject();
    for (const auto& [kitId, map] : midiOverrides)
    {
        auto m = makeObject();
        for (const auto& [slot, note] : map)
            setProp (m, slot, note);
        setProp (overrides, kitId, m);
    }
    setProp (o, "midiOverrides", overrides);
    return o;
}

void Session::restoreStateJson (const juce::var& state, Completion done)
{
    if (state["format"].toString() != stateFormat && state["format"].toString() != legacyStateFormat)
    {
        if (done)
            done (false, "Not a V.D.V.M plugin state.");
        return;
    }
    if (auto p = fromPatternJson (state["pattern"]))
        pat = *p;
    saved = state["saved"].isBool() && (bool) state["saved"];
    selectedSlotId = state["selectedSlotId"].toString();
    ref = KitReference::fromJson (state["library"]);
    if (ref.kitId.isEmpty())
        ref.kitId = pat.kitId;
    midiOverrides.clear();
    if (auto* obj = state["midiOverrides"].getDynamicObject())
        for (const auto& k : obj->getProperties())
            if (auto* m = k.value.getDynamicObject())
                for (const auto& s : m->getProperties())
                    midiOverrides[k.name.toString()][s.name.toString()] = (int) s.value;
    retryMissing (std::move (done));
}

void Session::retryMissing (Completion done)
{
    if (ref.kitId.isEmpty())
    {
        setStatus (KitStatus::idle);
        notify();
        if (done)
            done (false, "No kit selected.");
        return;
    }
    ++generation;
    const auto location = libraries.findKit (ref.libraryId, ref.kitId, ref.kitRevision.isNotEmpty() ? ref.kitRevision : pat.kitRevision);
    juce::String error;
    std::shared_ptr<Library> lib;
    std::optional<KitManifest> kit;
    if (location)
    {
        lib = libraries.get (location->libraryId, error);
        if (lib)
            kit = lib->loadKit (location->entry.id, error);
    }
    if (! kit)
    {
        // Keep the pattern and the reference exactly as saved; nothing else is bound.
        activeKit.reset();
        activeLibrary.reset();
        instrument.snapshots().publish (nullptr);
        const auto where = ref.libraryName.isNotEmpty() ? ref.libraryName : ref.libraryId;
        setStatus (KitStatus::missing, "Kit " + (ref.kitLabel.isNotEmpty() ? ref.kitLabel : ref.kitId) + " from "
                                           + (where.isNotEmpty() ? where : juce::String ("an unknown library"))
                                           + " is not available on this computer."
                                           + (ref.pathHint.isNotEmpty() ? " Last seen at " + ref.pathHint + "." : juce::String()));
        notify();
        if (done)
            done (false, lastError);
        return;
    }
    auto withPattern = pat;
    withPattern.kitId = kit->id; // a redirected kit id
    startLoad (lib, *kit, withPattern, std::move (done));
}

juce::var Session::toPresetJson() const
{
    auto o = makeObject();
    setProp (o, "format", presetFormat);
    setProp (o, "version", 1);
    setProp (o, "pattern", toPatternJson (pat));
    setProp (o, "library", ref.toJson());
    auto m = makeObject();
    for (const auto& [slot, note] : midiOverridesForKit())
        setProp (m, slot, note);
    setProp (o, "midiOverrides", m);
    return o;
}

bool Session::loadPresetJson (const juce::var& preset, juce::String& error, Completion done)
{
    if ((preset["format"].toString() != presetFormat && preset["format"].toString() != legacyPresetFormat) || (int) preset["version"] != 1)
    {
        error = "This file is not a V.D.V.M preset.";
        return false;
    }
    const auto p = fromPatternJson (preset["pattern"]);
    if (! p)
    {
        error = "The preset's pattern is damaged.";
        return false;
    }
    pat = *p;
    ref = KitReference::fromJson (preset["library"]);
    if (ref.kitId.isEmpty())
        ref.kitId = pat.kitId;
    if (auto* m = preset["midiOverrides"].getDynamicObject())
    {
        auto& o = midiOverrides[ref.kitId];
        o.clear();
        for (const auto& s : m->getProperties())
            o[s.name.toString()] = (int) s.value;
    }
    saved = false;
    retryMissing (std::move (done));
    return true;
}

void Session::collectGarbage()
{
    instrument.snapshots().collect();
    store.collectGarbage();
}

bool Session::waitUntilLoaded (int timeoutMs) const
{
    const auto until = juce::Time::getMillisecondCounter() + (juce::uint32) timeoutMs;
    while (loadsInFlight->load() > 0)
    {
        if (juce::Time::getMillisecondCounter() > until)
            return false;
        juce::Thread::sleep (2);
    }
    return true;
}
} // namespace drums
