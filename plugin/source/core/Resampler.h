// Offline windowed-sinc sample-rate conversion, run once per sample when it is
// decoded (as Web Audio's decodeAudioData converts to the context rate).
// Playback pitch is applied afterwards by the voice with cubic interpolation.
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

namespace drums
{
/** Convert `in` from inRate to outRate. Returns a copy when the rates match. */
juce::AudioBuffer<float> resampleBuffer (const juce::AudioBuffer<float>& in, double inRate, double outRate);
} // namespace drums
