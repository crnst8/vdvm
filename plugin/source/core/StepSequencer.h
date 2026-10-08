// Sample-accurate step scheduling inside the audio callback. Replaces the
// browser's timer lookahead (src/audio/scheduler.ts): each block is a span of
// musical time [ppqStart, ppqEnd) and every step whose position falls inside
// gets a frame offset.
//
// Steps sit on the absolute sixteenth grid of the timeline (step k at
// k * 0.25 quarter notes from ppq 0), so a 16-step pattern is one 4/4 bar and
// stays in phase with the host however playback starts, loops or jumps. The
// 8-step loop repeats steps 1-8 every half bar. Swing moves the off-beat
// steps of each pair (16th grid) or the last two steps of each group of four
// (8th grid); like the browser, the swing amount is latched at each pair (or
// group) start and the grid at every fourth step, so a live change cannot
// change a pair's length. A step whose window passed more than 50 ms ago is
// skipped, not burst late.
#pragma once

#include <juce_core/juce_core.h>
#include <algorithm>
#include <cmath>

namespace drums
{
struct SequencerSettings
{
    int length = 16;   // 16, or 8
    double swing = 50; // 50..75, the amount actually played (circuit swing already applied)
    int grid = 16;     // 16 or 8
};

struct StepEvent
{
    int step = 0;           // 0..length-1
    int offset = 0;         // frame within the block
    juce::int64 index = 0;  // absolute sixteenth index on the timeline
    double ppq = 0;         // musical position of the step
};

class StepSequencer
{
public:
    /** Forget position: the next block seeks to its start. */
    void reset() { started = false; }

    /**
     * Emit the steps of one block. `ppqPerFrame` comes from the block's tempo.
     * Returns true when the block did not continue the previous one (start, jump, loop),
     * so the caller can cancel hits queued past this point.
     */
    template <typename Emit>
    bool process (double ppqStart, double ppqPerFrame, int numFrames, const SequencerSettings& s, Emit&& emit)
    {
        const double ppqEnd = ppqStart + ppqPerFrame * numFrames;
        const double tolerance = std::max (2 * ppqPerFrame, 0.002);
        const bool jumped = ! started || std::abs (ppqStart - expectedPpq) > tolerance;
        if (jumped)
            seek (ppqStart, s);
        const double lateLimitPpq = lateLimitSecPpq (ppqPerFrame);
        for (;;)
        {
            latch (nextIndex, s);
            const double p = position (nextIndex);
            if (p >= ppqEnd)
                break;
            if (p < ppqStart - lateLimitPpq)
            {
                ++nextIndex; // missed window: skip, keep the grid
                ++skipped;
                continue;
            }
            const double frames = (p - ppqStart) / ppqPerFrame;
            const int offset = (int) std::max (0.0, std::ceil (frames - 1e-7));
            if (offset >= numFrames)
                break; // lands on the next block's first frame
            StepEvent e;
            e.index = nextIndex;
            e.step = (int) (((nextIndex % s.length) + s.length) % s.length);
            e.offset = offset;
            e.ppq = p;
            emit (e);
            ++nextIndex;
        }
        expectedPpq = ppqEnd;
        started = true;
        return jumped;
    }

    /** True when a block starting at ppqStart would not continue the previous one. */
    bool wouldJump (double ppqStart, double ppqPerFrame) const
    {
        return ! started || std::abs (ppqStart - expectedPpq) > std::max (2 * ppqPerFrame, 0.002);
    }

    void setSampleRate (double rate) { sampleRate = rate; }
    juce::int64 skippedSteps() const { return skipped; }

    /** Position of step `index` in quarter notes for straight timing (tests and export). */
    static double straightPosition (juce::int64 index) { return (double) index * 0.25; }

private:
    static juce::int64 floorDiv (juce::int64 a, juce::int64 b)
    {
        const auto q = a / b;
        return (a % b != 0 && ((a < 0) != (b < 0))) ? q - 1 : q;
    }

    double lateLimitSecPpq (double ppqPerFrame) const { return 0.05 * sampleRate * ppqPerFrame; }

    void latch (juce::int64 index, const SequencerSettings& s)
    {
        if (latchedIndex == index)
            return;
        latchedIndex = index;
        if (((index % 4) + 4) % 4 == 0)
            latchedGrid = s.grid == 8 ? 8 : 16;
        const int group = latchedGrid == 8 ? 4 : 2;
        if (((index % group) + group) % group == 0)
            latchedSwing = std::clamp (s.swing, 50.0, 75.0);
    }

    double position (juce::int64 index) const
    {
        const int group = latchedGrid == 8 ? 4 : 2;
        const auto groupStart = floorDiv (index, group) * group;
        const int i = (int) (index - groupStart);
        const double a = 0.25 * latchedSwing / 50.0;
        const double b = 0.25 * (100.0 - latchedSwing) / 50.0;
        double offset = 0;
        if (group == 2)
            offset = i == 0 ? 0 : a;
        else
            offset = i == 0 ? 0 : i == 1 ? a : i == 2 ? 2 * a : 2 * a + b;
        return (double) groupStart * 0.25 + offset;
    }

    void seek (double ppq, const SequencerSettings& s)
    {
        // Start at the grid latch point at or before ppq, then drop steps before ppq without counting them as missed.
        nextIndex = floorDiv ((juce::int64) std::floor (ppq / 0.25), 4) * 4;
        latchedIndex = INT64_MIN;
        latchedGrid = s.grid == 8 ? 8 : 16;
        latchedSwing = std::clamp (s.swing, 50.0, 75.0);
        for (;;)
        {
            latch (nextIndex, s);
            if (position (nextIndex) >= ppq - 1e-9)
                break;
            ++nextIndex;
        }
    }

    bool started = false;
    double expectedPpq = 0;
    juce::int64 nextIndex = 0;
    juce::int64 latchedIndex = INT64_MIN;
    int latchedGrid = 16;
    double latchedSwing = 50;
    double sampleRate = 48000;
    juce::int64 skipped = 0;
};
} // namespace drums
