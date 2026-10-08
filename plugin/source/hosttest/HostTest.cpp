// Loads the built VST3 the way a DAW does and checks it end to end: default
// kit on a fresh instance, project restore, host-synced playback at exact
// frames, offline render right after restore, state round trip into a second
// instance, MIDI input, and a project whose library is missing.
//   plugin/dev hosttest
// Uses VDVM_FACTORY_DIR (a catalog: public/ or the test kits in public/fixture/)
// and a throwaway VDVM_DATA_DIR.
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_events/juce_events.h>

#include <atomic>
#include <cstdio>
#include <thread>

namespace
{
int failures = 0;

void check (bool ok, const juce::String& what)
{
    std::printf ("%s %s\n", ok ? "  ok  " : "  FAIL", what.toRawUTF8());
    if (! ok)
        ++failures;
}

struct PlayHead final : juce::AudioPlayHead
{
    bool playing = false;
    double ppq = 0, bpm = 120;
    juce::Optional<PositionInfo> getPosition() const override
    {
        PositionInfo p;
        p.setIsPlaying (playing);
        p.setPpqPosition (ppq);
        p.setBpm (bpm);
        p.setTimeSignature (TimeSignature { 4, 4 });
        return p;
    }
};

void pump (int ms)
{
    const auto until = juce::Time::getMillisecondCounter() + (juce::uint32) ms;
    while (juce::Time::getMillisecondCounter() < until)
        juce::MessageManager::getInstance()->runDispatchLoopUntil (5);
}

/** Render `frames` on a worker thread (as hosts do) while this thread runs the message loop. */
juce::AudioBuffer<float> render (juce::AudioPluginInstance& p, PlayHead& head, int frames, juce::MidiBuffer firstBlockMidi = {})
{
    juce::AudioBuffer<float> out (2, frames);
    out.clear();
    std::atomic<bool> done { false };
    std::thread worker ([&]
    {
        juce::AudioBuffer<float> block (2, 512);
        for (int i = 0; i < frames; i += 512)
        {
            const int n = std::min (512, frames - i);
            block.setSize (2, n, false, false, true);
            block.clear();
            juce::MidiBuffer midi;
            if (i == 0)
                midi = firstBlockMidi;
            p.processBlock (block, midi);
            for (int c = 0; c < 2; ++c)
                out.copyFrom (c, i, block, c, 0, n);
            if (head.playing)
                head.ppq += head.bpm / 60.0 / 48000.0 * n;
        }
        done = true;
    });
    while (! done)
        juce::MessageManager::getInstance()->runDispatchLoopUntil (5);
    worker.join();
    return out;
}

std::vector<int> onsets (const juce::AudioBuffer<float>& b, float threshold)
{
    std::vector<int> out;
    int quietRun = 100000;
    for (int i = 0; i < b.getNumSamples(); ++i)
    {
        const float v = std::max (std::abs (b.getSample (0, i)), std::abs (b.getSample (1, i)));
        if (v > threshold && quietRun > 2400)
            out.push_back (i);
        quietRun = v > threshold ? 0 : quietRun + 1;
    }
    return out;
}

float peak (const juce::AudioBuffer<float>& b)
{
    return std::max (b.getMagnitude (0, 0, b.getNumSamples()), b.getMagnitude (1, 0, b.getNumSamples()));
}

/** A project chunk as a VST3 host stores it: the plugin's own state inside JUCE's VST3PluginState wrapper. */
juce::MemoryBlock stateFor (const juce::String& json)
{
    juce::ValueTree root ("VdvmState");
    root.setProperty ("version", 1, nullptr);
    root.setProperty ("json", json, nullptr);
    juce::MemoryBlock plugin;
    juce::AudioProcessor::copyXmlToBinary (*root.createXml(), plugin);
    juce::XmlElement wrapper ("VST3PluginState");
    wrapper.createNewChildElement ("IComponent")->addTextElement (plugin.toBase64Encoding());
    juce::MemoryBlock mb;
    juce::AudioProcessor::copyXmlToBinary (wrapper, mb);
    return mb;
}

juce::String projectJson (const juce::String& libraryId, const juce::String& kitId, const juce::String& revision,
                          const juce::String& kickSampleId = "x")
{
    return R"({"format":"vdvm-plugin-state","version":1,"saved":false,"selectedSlotId":"kick",
      "library":{"libraryId":")" + libraryId + R"(","kitId":")" + kitId + R"(","kitRevision":")" + revision + R"(","libraryName":"Test","kitLabel":"Test kit"},
      "midiOverrides":{},
      "pattern":{"schemaVersion":1,"id":"host-test","name":"HOST TEST","kitId":")" + kitId + R"(","kitRevision":")" + revision + R"(","bpm":120,
        "tracks":[{"slotId":"kick","sampleId":")" + kickSampleId + R"(","steps":[true,false,false,false,true,false,false,false,true,false,false,false,true,false,false,false]}],
        "updatedAt":"2026-10-08T00:00:00.000Z"}})";
}

juce::String stateJsonOf (juce::AudioPluginInstance& p)
{
    juce::MemoryBlock mb;
    p.getStateInformation (mb);
    const auto wrapper = juce::AudioProcessor::getXmlFromBinary (mb.getData(), (int) mb.getSize());
    const auto* component = wrapper != nullptr ? wrapper->getChildByName ("IComponent") : nullptr;
    juce::MemoryBlock plugin;
    if (component == nullptr || ! plugin.fromBase64Encoding (component->getAllSubText()))
        return {};
    const auto xml = juce::AudioProcessor::getXmlFromBinary (plugin.getData(), (int) plugin.getSize());
    return xml != nullptr ? xml->getStringAttribute ("json") : juce::String();
}
} // namespace

int main (int argc, char** argv)
{
    juce::ScopedJuceInitialiser_GUI gui;
    if (argc < 2)
    {
        std::printf ("usage: DrumsHostTest <path to V.D.V.M.vst3>\n");
        return 2;
    }
    juce::AudioPluginFormatManager formats;
    formats.addFormat (new juce::VST3PluginFormat());
    juce::OwnedArray<juce::PluginDescription> types;
    juce::VST3PluginFormat vst3;
    vst3.findAllTypesForFile (types, juce::String (argv[1]));
    check (types.size() == 1, "VST3 found: " + juce::String (argv[1]));
    if (types.isEmpty())
        return 1;
    check (types[0]->isInstrument, "registered as an instrument");

    const auto create = [&]
    {
        juce::String error;
        auto p = formats.createPluginInstance (*types[0], 48000, 512, error);
        if (p == nullptr)
            std::printf ("create failed: %s\n", error.toRawUTF8());
        p->setPlayConfigDetails (0, 2, 48000, 512);
        p->prepareToPlay (48000, 512);
        return p;
    };

    // The plugin's default kit when the factory catalog has it, otherwise its first kit.
    const auto factory = juce::File (juce::SystemStats::getEnvironmentVariable ("VDVM_FACTORY_DIR", {}));
    const auto index = juce::JSON::parse (factory.getChildFile ("catalog/index.json"));
    juce::var entry;
    if (const auto* kits = index["kits"].getArray())
        for (const auto& k : *kits)
            if (entry.isVoid() || k["id"].toString() == "linn-linndrum-main")
                entry = k;
    const auto kitId = entry["id"].toString();
    const auto kitRevision = entry["revision"].toString();
    check (kitId.isNotEmpty(), "factory catalog has a kit: " + factory.getFullPathName());

    std::printf ("fresh instance\n");
    auto a = create();
    pump (3000);
    const auto fresh = stateJsonOf (*a);
    if (juce::SystemStats::getEnvironmentVariable ("VDVM_HOSTTEST_VERBOSE", {}).isNotEmpty())
        std::printf ("%s\n", fresh.toRawUTF8());
    check (fresh.contains (kitId), "a fresh instance loads the factory default kit");

    std::printf ("project restore + offline render right away\n");
    PlayHead head;
    a->setPlayHead (&head);
    const auto manifest = juce::JSON::parse (factory.getChildFile (entry["url"].toString()));
    juce::String kick;
    for (const auto& slot : *manifest["slots"].getArray())
        if (slot["id"].toString() == "kick")
            kick = slot["defaultSampleId"].toString();
    check (kick.isNotEmpty(), "factory kit manifest readable, with a kick");
    const auto state = stateFor (projectJson ("factory", kitId, kitRevision, kick));
    a->setStateInformation (state.getData(), (int) state.getSize());
    a->setNonRealtime (true);
    head.playing = true;
    head.ppq = 0;
    const auto first = render (*a, head, 96000);
    a->setNonRealtime (false);
    const auto got = onsets (first, 0.01f);
    juce::String where;
    for (int g : got)
        where << g << " ";
    check (got.size() == 4, "four kick onsets in one bar: " + where);
    bool onGrid = got.size() == 4;
    for (size_t i = 0; i < got.size() && i < 4; ++i)
        onGrid = onGrid && got[i] >= (int) i * 24000 && got[i] <= (int) i * 24000 + 64;
    check (onGrid, "each onset within 64 frames after its step (frame 0, 24000, 48000, 72000)");
    check (peak (first) < 1.0f, "no clipping");

    std::printf ("state round trip into a second instance\n");
    juce::MemoryBlock saved;
    a->getStateInformation (saved);
    auto b = create();
    PlayHead headB;
    b->setPlayHead (&headB);
    b->setStateInformation (saved.getData(), (int) saved.getSize());
    pump (2000);
    head.ppq = 0;
    headB.playing = true;
    headB.ppq = 0;
    const auto again = render (*a, head, 48000);
    const auto other = render (*b, headB, 48000);
    float diff = 0;
    for (int c = 0; c < 2; ++c)
        for (int i = 0; i < 48000; ++i)
            diff = std::max (diff, std::abs (again.getSample (c, i) - other.getSample (c, i)));
    check (diff < 1.0e-6f, "restored instance renders the same audio (max diff " + juce::String (diff) + ")");

    std::printf ("MIDI input with the transport stopped\n");
    head.playing = false;
    render (*a, head, 48000); // let tails finish
    juce::MidiBuffer midi;
    midi.addEvent (juce::MidiMessage::noteOn (10, 36, (juce::uint8) 127), 300);
    const auto hit = render (*a, head, 24000, midi);
    const auto midiOnsets = onsets (hit, 0.01f);
    check (midiOnsets.size() == 1 && midiOnsets[0] >= 300 && midiOnsets[0] < 364, "note 36 plays the kick at its sample offset");

    std::printf ("project whose library is missing\n");
    auto c = create();
    PlayHead headC;
    c->setPlayHead (&headC);
    const auto missing = stateFor (projectJson ("user-gone-1234567890", "my-missing-kit", "0123456789abcdef"));
    c->setStateInformation (missing.getData(), (int) missing.getSize());
    pump (1500);
    headC.playing = true;
    const auto silent = render (*c, headC, 48000);
    check (peak (silent) == 0.0f, "plays nothing instead of another kit");
    const auto kept = stateJsonOf (*c);
    check (kept.contains ("user-gone-1234567890") && kept.contains ("my-missing-kit") && kept.contains ("HOST TEST"),
           "saving again keeps the missing library reference and the pattern");

    a->releaseResources();
    b->releaseResources();
    c->releaseResources();
    a.reset();
    b.reset();
    c.reset();
    pump (200);
    std::printf ("\n%s: %d failure(s)\n", failures == 0 ? "PASS" : "FAIL", failures);
    return failures == 0 ? 0 : 1;
}
