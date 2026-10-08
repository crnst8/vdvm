// Slot <-> MIDI note mapping, used for incoming notes, exported MIDI files
// and shown in the UI. Defaults start from General MIDI percussion
// (src/audio/export.ts GM_NOTES) but every slot gets a unique note: a slot
// whose GM note is taken or missing gets the lowest free note from 36 upward,
// never the shared fallback note 75 the browser export uses. User overrides
// (per kit) win; a default that collides with an override moves to a free note.
#pragma once

#include "Contract.h"

#include <array>
#include <map>
#include <vector>

namespace drums
{
struct MidiMap
{
    std::vector<std::pair<juce::String, int>> slotNotes; // kit slot order
    std::array<int, 128> slotIndexForNote;                // -1 = unmapped

    int noteFor (const juce::String& slotId) const;
};

using MidiOverrides = std::map<juce::String, int>; // slotId -> note

MidiMap buildMidiMap (const KitManifest& kit, const MidiOverrides& overrides = {});
MidiMap buildMidiMap (const std::vector<std::pair<juce::String, juce::String>>& slotIdAndCategory, const MidiOverrides& overrides);

juce::String midiNoteName (int note); // "C1" = 36, as most DAWs label drum maps
} // namespace drums
