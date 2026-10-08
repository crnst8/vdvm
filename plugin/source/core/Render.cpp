#include "Render.h"
#include "DrumEngine.h"
#include "Resampler.h"

namespace drums
{
namespace
{
    double swungStepSec (double bpm, int step, double amount, int grid)
    {
        const double sixteenth = 60.0 / bpm / 4.0;
        const int group = grid == 8 ? 4 : 2;
        const int firstHalf = grid == 8 ? 2 : 1;
        return sixteenth * (step % group < firstHalf ? amount / 50.0 : (100.0 - amount) / 50.0);
    }

    /** The sample a slot plays under the pattern (export.ts chosenSample): default without a track, null when the variant is gone. */
    const Sample* chosenSample (const KitManifest& kit, const Slot& slot, const PatternState& p)
    {
        juce::String want = slot.defaultSampleId;
        if (p.kitId == kit.id)
            if (const auto it = p.tracks.find (slot.id); it != p.tracks.end())
                want = it->second.sampleId;
        if (! slot.sampleIds.contains (want))
            return nullptr;
        return kit.sample (want);
    }
} // namespace

StepTimes stepTimes (const PatternState& p)
{
    StepTimes st;
    double t = 0;
    for (int step = 0; step < p.length; ++step)
    {
        st.times.push_back (t);
        t += swungStepSec (p.bpm, step, p.swing, p.swingGrid);
    }
    st.duration = t;
    return st;
}

juce::AudioBuffer<float> renderLoop (const PatternState& p, const KitManifest& kit, const SampleSource& source, juce::String& error)
{
    constexpr double rate = exportSampleRate;
    constexpr int pitchGuardFrames = 128;
    const auto st = stepTimes (p);
    struct Sound
    {
        const Slot* slot = nullptr;
        const Sample* sample = nullptr;
        std::shared_ptr<SampleData> data;
    };
    std::vector<Sound> sounds;
    double tail = 0.1;
    for (const auto& slot : kit.slots)
    {
        Sound s;
        s.slot = &slot;
        s.sample = chosenSample (kit, slot, p);
        if (s.sample != nullptr)
        {
            auto decoded = source (*s.sample);
            if (decoded.error.isNotEmpty())
            {
                error = slot.label + " is not ready for export: " + decoded.error;
                return {};
            }
            auto data = std::make_shared<SampleData>();
            data->sha256 = s.sample->blobSha256;
            data->sourceRate = decoded.rate;
            data->level = measureHit (decoded.pcm, decoded.rate);
            data->normalisationDb = normalisationDb (data->level);
            data->pcm = resampleBuffer (decoded.pcm, decoded.rate, rate);
            data->rate = rate;
            tail = std::max (tail, data->durationSec());
            s.data = data;
        }
        sounds.push_back (s);
    }
    double latestEnd = 0;
    for (int step = 0; step < p.length; ++step)
    {
        for (const auto& s : sounds)
        {
            const auto it = p.tracks.find (s.slot->id);
            if (it == p.tracks.end() || ! it->second.stepsOn[(size_t) step] || ! s.data || hitGainDb (it->second, step) == -INFINITY)
                continue;
            latestEnd = std::max (latestEnd, st.times[(size_t) step] + s.data->durationSec() / pitchRate (hitPitchCents (p, &it->second, step)));
        }
    }
    const double seconds = std::max (st.duration + tail, latestEnd + pitchGuardFrames / rate);
    const int frames = (int) std::ceil (seconds * rate);
    DrumEngine engine;
    engine.prepare (rate);
    for (int step = 0; step < p.length; ++step)
    {
        const auto when = (juce::int64) std::llround (st.times[(size_t) step] * rate);
        for (const auto& s : sounds)
        {
            const auto it = p.tracks.find (s.slot->id);
            if (it == p.tracks.end() || ! it->second.stepsOn[(size_t) step] || ! s.data)
                continue;
            const double extra = hitGainDb (it->second, step);
            if (extra == -INFINITY)
                continue;
            Hit h;
            h.data = s.data.get();
            h.when = when;
            h.gainDb = s.data->normalisationDb + extra;
            h.pitchCents = hitPitchCents (p, &it->second, step);
            h.hat = s.slot->id == "hat-closed" ? HatRole::closed : s.slot->id == "hat-open" ? HatRole::open : HatRole::none;
            engine.trigger (h);
        }
    }
    juce::AudioBuffer<float> out (2, frames);
    out.clear();
    for (int i = 0; i < frames; i += 4096)
    {
        const int n = std::min (4096, frames - i);
        engine.render (out.getWritePointer (0, i), out.getWritePointer (1, i), n);
    }
    engine.killAll();
    return out;
}

juce::MemoryBlock wavBytes (const juce::AudioBuffer<float>& audio, double rate)
{
    // 16-bit PCM like export.ts wavBytes: clamp, then scale negative by 32768 and positive by 32767.
    const int channels = audio.getNumChannels();
    const int frames = audio.getNumSamples();
    const auto size = (juce::uint32) (frames * channels * 2);
    juce::MemoryOutputStream out;
    const auto u32 = [&] (juce::uint32 v) { out.writeInt ((int) v); };
    const auto u16 = [&] (int v) { out.writeShort ((short) v); };
    out.write ("RIFF", 4);
    u32 (36 + size);
    out.write ("WAVE", 4);
    out.write ("fmt ", 4);
    u32 (16);
    u16 (1);
    u16 (channels);
    u32 ((juce::uint32) rate);
    u32 ((juce::uint32) rate * (juce::uint32) channels * 2);
    u16 (channels * 2);
    u16 (16);
    out.write ("data", 4);
    u32 (size);
    for (int f = 0; f < frames; ++f)
    {
        for (int c = 0; c < channels; ++c)
        {
            const double v = std::clamp ((double) audio.getSample (c, f), -1.0, 1.0);
            out.writeShort ((short) jsRound (v * (v < 0 ? 32768.0 : 32767.0)));
        }
    }
    return out.getMemoryBlock();
}

juce::MemoryBlock midiFileBytes (const PatternState& p, const KitManifest& kit, const MidiMap& map)
{
    const auto st = stepTimes (p);
    struct Event
    {
        int tick;
        int order;
        std::vector<juce::uint8> bytes;
    };
    std::vector<Event> events;
    const int tempo = (int) jsRound (60000000.0 / p.bpm);
    events.push_back ({ 0, 0, { 0xff, 0x51, 3, (juce::uint8) (tempo >> 16), (juce::uint8) (tempo >> 8), (juce::uint8) tempo } });
    events.push_back ({ 0, 1, { 0xff, 0x58, 4, 4, 2, 24, 8 } });
    int order = 2;
    for (const auto& slot : kit.slots)
    {
        const auto it = p.tracks.find (slot.id);
        if (it == p.tracks.end() || chosenSample (kit, slot, p) == nullptr)
            continue;
        const int note = map.noteFor (slot.id);
        if (note < 0)
            continue;
        for (int step = 0; step < p.length; ++step)
        {
            if (! it->second.stepsOn[(size_t) step])
                continue;
            const double gain = hitGainDb (it->second, step);
            if (gain == -INFINITY)
                continue;
            const int velocity = std::clamp ((int) jsRound (127.0 * std::pow (10.0, gain / 40.0)), 1, 127);
            const int tick = (int) jsRound (st.times[(size_t) step] * p.bpm / 60.0 * 480);
            events.push_back ({ tick, order++, { 0x99, (juce::uint8) note, (juce::uint8) velocity } });
            events.push_back ({ tick + 30, order++, { 0x89, (juce::uint8) note, 0 } });
        }
    }
    std::stable_sort (events.begin(), events.end(), [] (const Event& a, const Event& b) { return a.tick < b.tick; });
    std::vector<juce::uint8> data;
    const auto vlq = [&] (juce::uint32 n)
    {
        juce::uint8 buf[5];
        int len = 0;
        buf[len++] = (juce::uint8) (n & 0x7f);
        while ((n >>= 7) > 0)
            buf[len++] = (juce::uint8) ((n & 0x7f) | 0x80);
        while (len > 0)
            data.push_back (buf[--len]);
    };
    int last = 0;
    for (const auto& e : events)
    {
        vlq ((juce::uint32) (e.tick - last));
        data.insert (data.end(), e.bytes.begin(), e.bytes.end());
        last = e.tick;
    }
    vlq ((juce::uint32) std::max (0, p.length * 120 - last));
    data.insert (data.end(), { 0xff, 0x2f, 0 });
    juce::MemoryOutputStream out;
    out.write ("MThd", 4);
    out.writeIntBigEndian (6);
    out.writeShortBigEndian (0);
    out.writeShortBigEndian (1);
    out.writeShortBigEndian (480);
    out.write ("MTrk", 4);
    out.writeIntBigEndian ((int) data.size());
    out.write (data.data(), data.size());
    return out.getMemoryBlock();
}
} // namespace drums
