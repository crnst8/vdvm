#include "Playback.h"

namespace drums
{
SnapshotPtr buildSnapshot (const PatternState& pattern, const KitManifest& kit, uint32_t kitTag, const MidiMap& midi,
                           const std::function<SamplePtr (const Sample&)>& dataFor, bool applyAtBar)
{
    auto s = std::make_shared<PlaybackSnapshot>();
    s->kitTag = kitTag;
    s->kitId = kit.id;
    s->machineId = kit.machineId;
    s->length = pattern.length == 8 ? 8 : 16;
    s->swingGrid = pattern.swingGrid == 8 ? 8 : 16;
    s->circuit = pattern.circuit;
    s->circuitProfile = pattern.circuit ? circuitFor (kit.machineId) : nullptr;
    s->applyAtBar = applyAtBar;
    s->slotForNote = midi.slotIndexForNote;
    const bool boundHere = pattern.kitId == kit.id;
    for (const auto& slot : kit.slots)
    {
        PlaybackSlot ps;
        ps.id = slot.id;
        ps.hat = slot.id == "hat-closed" ? HatRole::closed : slot.id == "hat-open" ? HatRole::open : HatRole::none;
        const auto it = pattern.tracks.find (slot.id);
        const TrackState* track = it == pattern.tracks.end() ? nullptr : &it->second;
        // A pattern bound to another kit (mid-switch) plays this kit's defaults; a variant this kit lacks stays silent.
        const auto wanted = boundHere && track != nullptr ? track->sampleId : slot.defaultSampleId;
        const Sample* sample = slot.sampleIds.contains (wanted) ? kit.sample (wanted) : nullptr;
        if (sample != nullptr)
        {
            if (auto data = dataFor (*sample))
            {
                ps.sample = data.get();
                ps.normalisationDb = data->normalisationDb;
                s->owned.push_back (std::move (data));
            }
        }
        if (track != nullptr)
        {
            ps.gainDb = track->gainDb;
            for (size_t i = 0; i < (size_t) steps; ++i)
            {
                ps.on[i] = track->stepsOn[i];
                ps.levelDb[i] = track->levels[i] > 0 ? 40 * std::log10 (track->levels[i]) : -INFINITY;
                ps.stepPitchCents[i] = track->stepPitchCents[i];
            }
        }
        s->slots.push_back (std::move (ps));
    }
    return s;
}

// --- exchange ------------------------------------------------------------------

void SnapshotExchange::publish (SnapshotPtr snapshot)
{
    std::lock_guard lock (mutex);
    if (owner)
        retired.push_back ({ owner, 0 });
    owner = std::move (snapshot);
    next.store (owner.get(), std::memory_order_seq_cst);
    // Epoch after the swap: a block that read the old pointer finishes before `blocks` moves past this value.
    const auto epoch = blocks.load (std::memory_order_seq_cst);
    if (! retired.empty())
        retired.back().epoch = epoch;
}

void SnapshotExchange::collect()
{
    std::vector<SnapshotPtr> dead;
    {
        std::lock_guard lock (mutex);
        for (auto it = retired.begin(); it != retired.end();)
        {
            const auto* p = it->snapshot.get();
            const bool blockBoundaryPassed = ! inProcess.load (std::memory_order_seq_cst)
                                             || blocks.load (std::memory_order_seq_cst) != it->epoch;
            const bool held = inUseCurrent.load (std::memory_order_seq_cst) == p || inUsePending.load (std::memory_order_seq_cst) == p;
            if (blockBoundaryPassed && ! held)
            {
                dead.push_back (std::move (it->snapshot));
                it = retired.erase (it);
            }
            else
            {
                ++it;
            }
        }
    }
}

SnapshotPtr SnapshotExchange::latest() const
{
    std::lock_guard lock (mutex);
    return owner;
}

void SnapshotExchange::beginBlock()
{
    inProcess.store (true, std::memory_order_seq_cst);
}

void SnapshotExchange::reportInUse (const PlaybackSnapshot* c, const PlaybackSnapshot* p)
{
    inUseCurrent.store (c, std::memory_order_seq_cst);
    inUsePending.store (p, std::memory_order_seq_cst);
}

void SnapshotExchange::endBlock()
{
    blocks.fetch_add (1, std::memory_order_seq_cst);
    inProcess.store (false, std::memory_order_seq_cst);
}

// --- instrument ----------------------------------------------------------------

Instrument::Instrument() = default;

void Instrument::prepare (double sampleRate, int)
{
    rate = sampleRate > 0 ? sampleRate : 48000;
    voiceEngine.prepare (rate);
    sequencer.setSampleRate (rate);
    sequencer.reset();
    wasRunning = false;
    playing = false;
    currentStep = -1;
}

void Instrument::reset()
{
    voiceEngine.killAll();
    sequencer.reset();
    wasRunning = false;
    playing = false;
    currentStep = -1;
}

void Instrument::queueAudition (const Audition& a)
{
    const auto scope = auditionFifo.write (1);
    if (scope.blockSize1 > 0)
        auditions[(size_t) scope.startIndex1] = a;
}

void Instrument::queuePreview (const SampleData* data, juce::uint64 seq)
{
    const auto scope = previewFifo.write (1);
    if (scope.blockSize1 > 0)
        previewQueue[(size_t) scope.startIndex1] = { data, seq };
}

double Instrument::trackGain (const PlaybackSnapshot& s, int i, const LiveParams& params) const
{
    if (i < automatablePads)
        return params.padGainDb[(size_t) i];
    return s.slots[(size_t) i].gainDb;
}

void Instrument::triggerSlot (const PlaybackSnapshot& s, int i, int step, juce::int64 when, double extraDb, double pitchOverride,
                              bool usePitchOverride, const LiveParams& params)
{
    if (i < 0 || i >= (int) s.slots.size())
        return;
    const auto& slot = s.slots[(size_t) i];
    if (slot.sample == nullptr)
        return;
    const double gain = trackGain (s, i, params);
    const double level = step >= 0 ? slot.levelDb[(size_t) step] : 0.0;
    if (! std::isfinite (gain) || ! std::isfinite (level) || ! std::isfinite (extraDb))
        return;
    Hit hit;
    hit.data = slot.sample;
    hit.when = when;
    hit.gainDb = slot.normalisationDb + gain + level + extraDb;
    hit.pitchCents = usePitchOverride ? pitchOverride : params.pitchCents + (step >= 0 ? slot.stepPitchCents[(size_t) step] : 0);
    hit.hat = slot.hat;
    hit.kitTag = s.kitTag;
    hit.slotIndex = i;
    voiceEngine.trigger (hit);
}

void Instrument::commit (const PlaybackSnapshot* s, juce::int64 at)
{
    if (current != nullptr && s != nullptr && current->kitTag != s->kitTag)
        voiceEngine.stopAll (at, true, current->kitTag);
    if (s == nullptr || current == nullptr || s->machineId != current->machineId)
        jitter.reset();
    current = s;
    committedKitTag = s != nullptr ? s->kitTag : 0;
}

void Instrument::process (float* left, float* right, int n, const HostPosition& host, const LiveParams& params,
                          const juce::MidiBuffer& midi)
{
    exchange.beginBlock();
    const juce::int64 now = voiceEngine.now();

    if (auto* pub = exchange.published(); pub != lastSeen)
    {
        lastSeen = pub;
        const bool atBar = pub != nullptr && pub->applyAtBar && wasRunning && current != nullptr && pub->kitTag != current->kitTag;
        if (atBar)
        {
            pending = pub;
        }
        else
        {
            pending = nullptr;
            commit (pub, now);
        }
    }
    exchange.reportInUse (current, pending);

    if (params.outputDb != voiceEngine.outputGainDb())
        voiceEngine.setOutputGainDb (params.outputDb);

    const bool hostDriven = params.hostSync && host.valid && host.playing;
    const bool running = (hostDriven || params.run) && current != nullptr;

    if (! running)
    {
        if (wasRunning)
        {
            // Host stop: queued hits are cancelled and tails ring, like a hardware sequencer under a DAW.
            // ON/OFF stop: the browser's 5 ms fade.
            if (wasHostDriven)
                voiceEngine.cancelFrom (now);
            else
                voiceEngine.stopAll (now);
            sequencer.reset();
            if (pending != nullptr)
            {
                commit (pending, now);
                pending = nullptr;
            }
        }
        currentStep = -1;
    }
    else
    {
        if (! wasRunning || hostDriven != wasHostDriven)
        {
            sequencer.reset();
            freePpq = 0;
        }
        // HOST mode uses the host's tempo even for ON/OFF while the host is stopped; FREE uses the plugin's own.
        const bool hostTempo = hostDriven || (params.hostSync && host.hasBpm);
        const double bpm = std::clamp (hostTempo ? host.bpm : params.bpm, 20.0, 999.0);
        const double ppqStart = hostDriven ? host.ppq : freePpq;
        const double ppf = bpm / 60.0 / rate;
        SequencerSettings settings;
        settings.length = current->length;
        settings.grid = current->swingGrid;
        settings.swing = params.swing;
        if (current->circuitProfile != nullptr)
        {
            const auto it = current->circuitProfile->swingGrids.find (current->swingGrid);
            if (it != current->circuitProfile->swingGrids.end())
                settings.swing = machineSwing (params.swing, &it->second);
        }
        if (wasRunning && sequencer.wouldJump (ppqStart, ppf))
            voiceEngine.cancelFrom (now); // host jump or loop: forget hits queued past here
        sequencer.process (ppqStart, ppf, n, settings, [&] (const StepEvent& e)
        {
            juce::int64 at = now + e.offset;
            if (e.step == 0 && pending != nullptr)
            {
                commit (pending, at);
                pending = nullptr;
            }
            const auto& s = *current;
            currentStep = e.step;
            const auto* profile = s.circuitProfile;
            if (profile != nullptr && profile->jitter)
            {
                if (! jitter || jitterFor != profile)
                {
                    jitter.emplace (*profile->jitter, jitterSeed);
                    jitterFor = profile;
                }
                // Hardware step jitter moves every voice of a step together.
                at += (juce::int64) std::lround (jitter->offsetSec (e.ppq * 60.0 / bpm) * rate);
            }
            for (int i = 0; i < (int) s.slots.size(); ++i)
                if (s.slots[(size_t) i].on[(size_t) e.step])
                    triggerSlot (s, i, e.step, at, 0.0, 0.0, false, params);
        });
        if (! hostDriven)
            freePpq += ppf * n;
    }
    hostTempo.store (host.hasBpm ? host.bpm : 0.0);
    wasRunning = running;
    wasHostDriven = running && hostDriven;
    playing = running;
    followingHost = running && hostDriven;

    if (current != nullptr)
    {
        for (const auto meta : midi)
        {
            const auto msg = meta.getMessage();
            if (! msg.isNoteOn())
                continue;
            const int slot = current->slotForNote[(size_t) msg.getNoteNumber()];
            if (slot < 0)
                continue;
            const double vel = msg.getFloatVelocity();
            triggerSlot (*current, slot, -1, now + std::clamp (meta.samplePosition, 0, n - 1), 40 * std::log10 (vel), 0, false, params);
        }
    }

    const int ready = auditionFifo.getNumReady();
    if (ready > 0)
    {
        const auto scope = auditionFifo.read (ready);
        const auto run = [&] (int start, int size)
        {
            for (int k = 0; k < size; ++k)
            {
                const auto& a = auditions[(size_t) (start + k)];
                if (current != nullptr && a.kitTag == current->kitTag)
                    triggerSlot (*current, a.slotIndex, a.step, now, 0, 0, false, params);
            }
        };
        run (scope.startIndex1, scope.blockSize1);
        run (scope.startIndex2, scope.blockSize2);
    }

    if (const int waiting = previewFifo.getNumReady(); waiting > 0)
    {
        const auto scope = previewFifo.read (waiting);
        const auto play = [&] (int start, int size)
        {
            for (int k = 0; k < size; ++k)
            {
                const auto& pv = previewQueue[(size_t) (start + k)];
                if (pv.data != nullptr)
                {
                    Hit h;
                    h.data = pv.data;
                    h.when = now;
                    h.gainDb = pv.data->normalisationDb;
                    voiceEngine.trigger (h);
                }
                previewsConsumed.store (std::max (previewsConsumed.load(), pv.seq));
            }
        };
        play (scope.startIndex1, scope.blockSize1);
        play (scope.startIndex2, scope.blockSize2);
    }

    voiceEngine.render (left, right, n);
    voices = voiceEngine.activeVoices();
    exchange.reportInUse (current, pending);
    exchange.endBlock();
}
} // namespace drums
