#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "core/Json.h"

namespace drums
{
namespace
{
    const juce::Identifier stateTag ("VdvmState");
    const juce::Identifier legacyStateTag ("DrumsState"); // projects saved before the product was named V.D.V.M
    constexpr const char* defaultKitId = "linn-linndrum-main";

    juce::String padId (int i) { return "pad" + juce::String (i + 1); }
} // namespace

juce::AudioProcessorValueTreeState::ParameterLayout DrumsProcessor::createLayout()
{
    using namespace juce;
    AudioProcessorValueTreeState::ParameterLayout layout;
    const auto db = [] (float v, int) { return v <= -36.75f ? String ("Off") : String (v, 1) + " dB"; };
    layout.add (std::make_unique<AudioParameterFloat> (ParameterID { "output", 1 }, "Output", NormalisableRange<float> (-24.0f, 12.0f, 0.5f), 0.0f,
                                                       AudioParameterFloatAttributes().withLabel ("dB")));
    layout.add (std::make_unique<AudioParameterInt> (ParameterID { "swing", 1 }, "Swing", 50, 75, 50, AudioParameterIntAttributes().withLabel ("%")));
    layout.add (std::make_unique<AudioParameterInt> (ParameterID { "pitch", 1 }, "Pitch", pitchMinCents, pitchMaxCents, 0,
                                                     AudioParameterIntAttributes()
                                                         .withLabel ("cents")
                                                         .withStringFromValueFunction ([] (int c, int) { return String (c / 100.0, 2) + " st"; })));
    layout.add (std::make_unique<AudioParameterInt> (ParameterID { "bpm", 1 }, "Tempo (free run)", bpmMin, bpmMax, bpmDefault,
                                                     AudioParameterIntAttributes().withLabel ("BPM")));
    layout.add (std::make_unique<AudioParameterBool> (ParameterID { "hostSync", 1 }, "Tempo from host", true));
    layout.add (std::make_unique<AudioParameterBool> (ParameterID { "run", 1 }, "Run (free run)", false));
    for (int i = 0; i < automatablePads; ++i)
        layout.add (std::make_unique<AudioParameterFloat> (ParameterID { padId (i), 1 }, "Pad " + String (i + 1) + " volume",
                                                           NormalisableRange<float> (-37.0f, 6.0f, 0.5f), 0.0f,
                                                           AudioParameterFloatAttributes().withLabel ("dB").withStringFromValueFunction (db)));
    return layout;
}

DrumsProcessor::DrumsProcessor()
    : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      libraryManager ((LibraryManager::migrateLegacyDataDir(), LibraryManager::defaultDataDir()), LibraryManager::defaultFactoryDirs()),
      patternStore (LibraryManager::defaultDataDir().getChildFile ("Patterns/patterns.json")),
      prefsStore (LibraryManager::defaultDataDir().getChildFile ("prefs.json")),
      apvts (*this, nullptr, "params", createLayout())
{
    LoudnessCache::instance().setFile (LibraryManager::defaultDataDir().getChildFile ("Cache/loudness.json"));
    // New instances open at the last view the user chose; projects keep their own.
    {
        const auto p = prefsStore.get();
        if (p["viewScale"].isDouble() || p["viewScale"].isInt())
            editorScale = std::clamp ((double) p["viewScale"], 0.5, 1.5);
        if (p["viewLayout"].toString() == "compact")
            editorLayout = "compact";
        const auto base = viewBaseSize (editorLayout);
        editorWidth = (int) std::lround (base.x * editorScale);
        editorHeight = (int) std::lround (base.y * editorScale);
    }
    sessionPtr = std::make_unique<Session> (libraryManager, store, instrumentCore,
                                            [] (std::function<void()> f) { juce::MessageManager::callAsync (std::move (f)); });
    sessionPtr->addListener ([this]
    {
        if (emit)
            emit ("drums:status", statusJson());
    });
    pOutput = apvts.getRawParameterValue ("output");
    pSwing = apvts.getRawParameterValue ("swing");
    pPitch = apvts.getRawParameterValue ("pitch");
    pBpm = apvts.getRawParameterValue ("bpm");
    pSync = apvts.getRawParameterValue ("hostSync");
    pRun = apvts.getRawParameterValue ("run");
    for (int i = 0; i < automatablePads; ++i)
        pPads[(size_t) i] = apvts.getRawParameterValue (padId (i));
    for (const auto* id : { "swing", "pitch", "bpm" })
        apvts.addParameterListener (id, this);
    for (int i = 0; i < automatablePads; ++i)
        apvts.addParameterListener (padId (i), this);
    // A new instance plays the default kit unless the host restores a project first.
    juce::MessageManager::callAsync ([alive = alive, this]
    {
        if (*alive && ! stateRestored)
            bootDefaultKit();
    });
    startTimerHz (30);
}

DrumsProcessor::~DrumsProcessor()
{
    *alive = false;
    stopTimer();
    emit = nullptr;
    LoudnessCache::instance().flush();
}

void DrumsProcessor::bootDefaultKit()
{
    const auto p = prefsStore.get();
    const auto libs = libraryManager.records();
    juce::String libraryId, kitId;
    const auto has = [&] (const juce::String& lib, const juce::String& kit)
    {
        juce::String error;
        auto l = libraryManager.get (lib, error);
        return l != nullptr && (kit.isEmpty() || l->index().kitEntry (kit) != nullptr);
    };
    if (has (p["lastLibraryId"].toString(), p["lastKitId"].toString()) && p["lastKitId"].toString().isNotEmpty())
    {
        libraryId = p["lastLibraryId"].toString();
        kitId = p["lastKitId"].toString();
    }
    else if (has ("factory", defaultKitId))
    {
        libraryId = "factory";
        kitId = defaultKitId;
    }
    else
    {
        for (const auto& r : libs)
        {
            juce::String error;
            if (auto l = libraryManager.get (r.id, error); l != nullptr && ! l->index().kits.empty())
            {
                libraryId = r.id;
                kitId = l->index().kits.front().id;
                break;
            }
        }
    }
    if (libraryId.isEmpty())
    {
        // Unbundled first run: no library yet. The UI opens on its Sources tab.
        if (! libs.empty())
            browseLibrary = libs.front().id;
        return;
    }
    browseLibrary = libraryId;
    sessionPtr->selectKit (libraryId, kitId, [this] (bool ok, const juce::String&)
    {
        if (ok)
            emitExternalChange();
    });
}

void DrumsProcessor::setBrowseLibrary (const juce::String& id)
{
    browseLibrary = id;
    auto patch = makeObject();
    setProp (patch, "lastLibraryId", id);
    prefsStore.merge (patch);
}

// --- audio ---------------------------------------------------------------------------

void DrumsProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    instrumentCore.prepare (sampleRate, samplesPerBlock);
    const bool rateChanged = preparedRate != 0 && preparedRate != sampleRate;
    preparedRate = sampleRate;
    store.setTargetRate (sampleRate);
    if (rateChanged)
    {
        // Samples are converted to the host rate when decoded: reload the kit at the new rate.
        // Until then the old data keeps playing at the right pitch (voices step by each sample's own rate).
        juce::MessageManager::callAsync ([alive = alive, this]
        {
            if (*alive && sessionPtr->kit())
                sessionPtr->reloadActiveKit();
        });
    }
}

void DrumsProcessor::releaseResources()
{
    instrumentCore.reset();
}

bool DrumsProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto out = layouts.getMainOutputChannelSet();
    return out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono();
}

void DrumsProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    const int n = buffer.getNumSamples();
    buffer.clear();
    // An offline bounce right after a project opens must not render the start silent while samples load.
    if (isNonRealtime() && ! juce::MessageManager::existsAndIsCurrentThread())
        sessionPtr->waitUntilLoaded (30000);

    HostPosition host;
    if (auto* playHead = getPlayHead())
    {
        if (const auto pos = playHead->getPosition())
        {
            host.playing = pos->getIsPlaying();
            if (const auto ppq = pos->getPpqPosition())
            {
                host.valid = true;
                host.ppq = *ppq;
            }
            if (const auto bpm = pos->getBpm(); bpm && *bpm > 0)
            {
                host.hasBpm = true;
                host.bpm = *bpm;
            }
        }
    }
    LiveParams live;
    live.outputDb = pOutput->load();
    live.swing = pSwing->load();
    live.pitchCents = (int) std::lround (pPitch->load());
    live.bpm = pBpm->load();
    live.hostSync = pSync->load() > 0.5f;
    live.run = pRun->load() > 0.5f;
    for (size_t i = 0; i < (size_t) automatablePads; ++i)
        live.padGainDb[i] = padParamToGain (pPads[i]->load());

    float* left = buffer.getWritePointer (0);
    float* right = buffer.getNumChannels() > 1 ? buffer.getWritePointer (1) : nullptr;
    if (right != nullptr)
    {
        instrumentCore.process (left, right, n, host, live, midi);
    }
    else
    {
        // Mono output: render stereo into a scratch half, then average.
        float scratch[512];
        for (int start = 0; start < n; start += 512)
        {
            const int len = std::min (512, n - start);
            std::fill (scratch, scratch + len, 0.0f);
            juce::MidiBuffer slice;
            for (const auto m : midi)
                if (m.samplePosition >= start && m.samplePosition < start + len)
                    slice.addEvent (m.getMessage(), m.samplePosition - start);
            instrumentCore.process (left + start, scratch, len, host, live, slice);
            for (int i = 0; i < len; ++i)
                left[start + i] = 0.5f * (left[start + i] + scratch[i]);
            if (host.valid && host.playing)
                host.ppq += host.bpm / 60.0 / getSampleRate() * len;
        }
    }
    midi.clear();
}

// --- UI-driven changes -------------------------------------------------------------------

void DrumsProcessor::applyPatternFromUi (const PatternState& p)
{
    const juce::ScopedValueSetter<bool> guard (applyingFromUi, true);
    const auto set = [this] (const char* id, float value)
    {
        if (auto* param = apvts.getParameter (id))
        {
            const float norm = param->convertTo0to1 (value);
            if (std::abs (param->getValue() - norm) > 1.0e-6f)
                param->setValueNotifyingHost (norm);
        }
    };
    set ("swing", (float) p.swing);
    set ("pitch", (float) p.pitchCents);
    set ("bpm", (float) p.bpm);
    if (const auto& kit = sessionPtr->kit(); kit && kit->id == p.kitId)
    {
        for (int i = 0; i < automatablePads && i < (int) kit->slots.size(); ++i)
        {
            const auto it = p.tracks.find (kit->slots[(size_t) i].id);
            set (padId (i).toRawUTF8(), gainToPadParam (it == p.tracks.end() ? 0.0 : it->second.gainDb));
        }
    }
    sessionPtr->setPattern (p);
}

void DrumsProcessor::parameterChanged (const juce::String&, float)
{
    // Host automation or a generic plugin UI moved a pattern parameter; fold it into the pattern on the message thread.
    if (! applyingFromUi)
        paramsDirty = true;
}

void DrumsProcessor::syncParamsToPattern()
{
    auto p = sessionPtr->pattern();
    if (p.kitId.isEmpty())
        return;
    bool changed = false;
    const int swing = clampSwing (pSwing->load());
    const int pitch = clampPitchCents (pPitch->load());
    const int bpm = clampBpm (pBpm->load());
    changed |= std::exchange (p.swing, swing) != swing;
    changed |= std::exchange (p.pitchCents, pitch) != pitch;
    changed |= std::exchange (p.bpm, bpm) != bpm;
    if (const auto& kit = sessionPtr->kit(); kit && kit->id == p.kitId)
    {
        for (int i = 0; i < automatablePads && i < (int) kit->slots.size(); ++i)
        {
            auto it = p.tracks.find (kit->slots[(size_t) i].id);
            if (it == p.tracks.end())
                continue;
            const double g = clampTrackGain (padParamToGain (pPads[(size_t) i]->load()));
            if (g != it->second.gainDb)
            {
                it->second.gainDb = g;
                changed = true;
            }
        }
    }
    if (changed)
    {
        sessionPtr->setPattern (p);
        emitExternalChange();
    }
}

void DrumsProcessor::setOutputDb (double db)
{
    if (auto* param = apvts.getParameter ("output"))
        param->setValueNotifyingHost (param->convertTo0to1 ((float) std::clamp (db, outputGainMinDb, outputGainMaxDb)));
}

void DrumsProcessor::setHostSync (bool on)
{
    if (auto* param = apvts.getParameter ("hostSync"))
        param->setValueNotifyingHost (on ? 1.0f : 0.0f);
    if (emit)
        emit ("drums:status", statusJson());
}

void DrumsProcessor::transportCommand (const juce::String& command)
{
    auto* run = apvts.getParameter ("run");
    if (run == nullptr)
        return;
    const bool running = run->getValue() > 0.5f;
    bool next = running;
    if (command == "play")
        next = true;
    else if (command == "stop")
        next = false;
    else if (instrumentCore.followingHost.load())
        return; // the host's transport is playing: its stop key stops it
    else
        next = ! (running || instrumentCore.playing.load());
    if (next != running)
        run->setValueNotifyingHost (next ? 1.0f : 0.0f);
}

void DrumsProcessor::audition (const juce::String& slotId, int step)
{
    const auto& kit = sessionPtr->kit();
    if (! kit)
        return;
    for (int i = 0; i < (int) kit->slots.size(); ++i)
        if (kit->slots[(size_t) i].id == slotId)
            instrumentCore.queueAudition ({ i, step >= 0 && step < steps ? step : -1, instrumentCore.committedKitTag.load() });
}

void DrumsProcessor::preview (SamplePtr data)
{
    if (! data)
        return;
    const auto seq = ++previewSeq;
    instrumentCore.queuePreview (data.get(), seq);
    previews.push_back ({ std::move (data), seq });
}

// --- timer: garbage, parameter sync, playhead and status for the UI ----------------------------

void DrumsProcessor::timerCallback()
{
    sessionPtr->collectGarbage();
    const auto consumed = instrumentCore.previewsConsumed.load();
    previews.erase (std::remove_if (previews.begin(), previews.end(),
                                    [consumed] (const HeldPreview& p) { return p.seq <= consumed && p.data->voiceRefs.load() == 0; }),
                    previews.end());
    if (paramsDirty.exchange (false))
        syncParamsToPattern();
    if (! emit)
        return;
    const int step = instrumentCore.playing.load() ? instrumentCore.currentStep.load() : -1;
    const bool playing = instrumentCore.playing.load();
    if (step != lastPlayhead)
    {
        lastPlayhead = step;
        auto o = makeObject();
        setProp (o, "step", step);
        emit ("drums:playhead", o);
    }
    const double tempo = std::round (instrumentCore.hostTempo.load() * 100) / 100;
    if (playing != lastPlaying || tempo != lastHostTempo)
    {
        lastPlaying = playing;
        lastHostTempo = tempo;
        emit ("drums:status", statusJson());
    }
}

juce::var DrumsProcessor::statusJson() const
{
    const auto& s = *sessionPtr;
    auto o = makeObject();
    setProp (o, "kitStatus", toString (s.status()));
    setProp (o, "libraryId", s.reference().libraryId.isNotEmpty() && s.kit() ? juce::var (s.reference().libraryId) : juce::var());
    setProp (o, "kitId", s.kit() ? juce::var (s.kit()->id) : juce::var());
    setProp (o, "pendingKitId", s.pendingKitId().isNotEmpty() ? juce::var (s.pendingKitId()) : juce::var());
    auto progress = makeObject();
    setProp (progress, "done", s.progress().first);
    setProp (progress, "total", s.progress().second);
    setProp (o, "progress", progress);
    setProp (o, "playing", instrumentCore.playing.load());
    setProp (o, "followingHost", instrumentCore.followingHost.load());
    setProp (o, "hostSync", pSync->load() > 0.5f);
    const double tempo = instrumentCore.hostTempo.load();
    setProp (o, "hostBpm", tempo > 0 ? juce::var (std::round (tempo * 100) / 100) : juce::var());
    setProp (o, "standalone", wrapperType == wrapperType_Standalone);
    setProp (o, "error", s.error().isNotEmpty() ? juce::var (s.error()) : juce::var());
    juce::Array<juce::var> ready;
    if (s.kit())
        for (const auto& smp : s.kit()->samples)
            if (store.has (smp.blobSha256))
                ready.add (smp.id);
    setProp (o, "readySampleIds", ready);
    return o;
}

juce::var DrumsProcessor::librariesJson()
{
    juce::Array<juce::var> list;
    for (const auto& r : libraryManager.records())
    {
        auto o = makeObject();
        setProp (o, "id", r.id);
        setProp (o, "kind", toString (r.kind));
        setProp (o, "name", r.name);
        setProp (o, "path", r.root.getFullPathName());
        setProp (o, "linkedPath", r.kind == LibraryKind::linked ? juce::var (r.linkedRoot.getFullPathName()) : juce::var());
        setProp (o, "writable", r.kind == LibraryKind::user || r.kind == LibraryKind::linked);
        juce::String error;
        const auto lib = libraryManager.get (r.id, error);
        setProp (o, "available", lib != nullptr && (r.kind != LibraryKind::linked || r.linkedRoot.isDirectory()));
        setProp (o, "problem", lib != nullptr ? (r.kind == LibraryKind::linked && ! r.linkedRoot.isDirectory() ? juce::var ("Linked folder missing") : juce::var())
                                              : juce::var (error));
        setProp (o, "kits", lib != nullptr ? (int) lib->index().kits.size() : 0);
        setProp (o, "imported", lib != nullptr ? (int) lib->imported().size() : 0);
        list.add (o);
    }
    auto root = makeObject();
    setProp (root, "libraries", list);
    setProp (root, "activeLibraryId", browseLibrary.isNotEmpty() ? juce::var (browseLibrary) : juce::var());
    return root;
}

void DrumsProcessor::emitExternalChange()
{
    const auto& s = *sessionPtr;
    if (s.kit())
    {
        browseLibrary = s.reference().libraryId;
        auto patch = makeObject();
        setProp (patch, "lastLibraryId", s.reference().libraryId);
        setProp (patch, "lastKitId", s.kit()->id);
        prefsStore.merge (patch);
    }
    // Parameters follow the pattern (state restore, presets).
    {
        const juce::ScopedValueSetter<bool> guard (applyingFromUi, true);
        const auto& p = s.pattern();
        if (p.kitId.isNotEmpty())
        {
            for (const auto& [id, value] : { std::pair { "swing", (float) p.swing }, std::pair { "pitch", (float) p.pitchCents },
                                             std::pair { "bpm", (float) p.bpm } })
                if (auto* param = apvts.getParameter (id))
                    param->setValueNotifyingHost (param->convertTo0to1 (value));
            if (s.kit())
                for (int i = 0; i < automatablePads && i < (int) s.kit()->slots.size(); ++i)
                    if (const auto it = p.tracks.find (s.kit()->slots[(size_t) i].id); it != p.tracks.end())
                        if (auto* param = apvts.getParameter (padId (i)))
                            param->setValueNotifyingHost (param->convertTo0to1 (gainToPadParam (it->second.gainDb)));
        }
    }
    if (! emit)
        return;
    auto o = makeObject();
    setProp (o, "pattern", s.pattern().kitId.isNotEmpty() ? toPatternJson (s.pattern()) : juce::var());
    setProp (o, "saved", s.savedFlag());
    setProp (o, "selectedSlotId", s.selectedSlot());
    setProp (o, "libraryId", s.kit() ? juce::var (s.reference().libraryId) : juce::var());
    setProp (o, "kitId", s.kit() ? juce::var (s.kit()->id) : juce::var());
    emit ("drums:external", o);
    emit ("drums:libraries", librariesJson());
    emit ("drums:status", statusJson());
}

// --- state -------------------------------------------------------------------------------------

void DrumsProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    juce::ValueTree root (stateTag);
    root.setProperty ("version", 1, nullptr);
    root.setProperty ("json", juce::JSON::toString (sessionPtr->toStateJson(), true), nullptr);
    root.setProperty ("editorWidth", editorWidth, nullptr);
    root.setProperty ("editorHeight", editorHeight, nullptr);
    root.setProperty ("editorScale", editorScale, nullptr);
    root.setProperty ("editorLayout", editorLayout, nullptr);
    root.appendChild (apvts.copyState(), nullptr);
    if (auto xml = root.createXml())
        copyXmlToBinary (*xml, destData);
}

void DrumsProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    const auto xml = getXmlFromBinary (data, sizeInBytes);
    if (xml == nullptr || ! (xml->hasTagName (stateTag) || xml->hasTagName (legacyStateTag)))
        return;
    const auto root = juce::ValueTree::fromXml (*xml);
    stateRestored = true;
    editorWidth = (int) root.getProperty ("editorWidth", editorWidth);
    editorHeight = (int) root.getProperty ("editorHeight", editorHeight);
    editorScale = std::clamp ((double) root.getProperty ("editorScale", editorScale), 0.5, 1.5);
    editorLayout = root.getProperty ("editorLayout", editorLayout).toString();
    const auto params = root.getChildWithName (apvts.state.getType());
    const auto json = root.getProperty ("json").toString();
    auto apply = [this, params, json]
    {
        if (params.isValid())
        {
            const juce::ScopedValueSetter<bool> guard (applyingFromUi, true);
            apvts.replaceState (params);
        }
        juce::String error;
        const auto parsed = parseJson (json, error);
        if (! parsed)
            return;
        sessionPtr->restoreStateJson (*parsed, [this] (bool, const juce::String&) { emitExternalChange(); });
        if (emit)
            emit ("drums:status", statusJson());
    };
    if (juce::MessageManager::existsAndIsCurrentThread())
        apply();
    else
        juce::MessageManager::callAsync ([alive = alive, apply]
        {
            if (*alive)
                apply();
        });
}

juce::AudioProcessorEditor* DrumsProcessor::createEditor()
{
    return new DrumsEditor (*this);
}
} // namespace drums

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new drums::DrumsProcessor();
}
