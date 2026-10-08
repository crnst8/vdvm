#include "MidiMap.h"
#include "Timing.h"

#include <set>

namespace drums
{
int MidiMap::noteFor (const juce::String& slotId) const
{
    for (const auto& [id, note] : slotNotes)
        if (id == slotId)
            return note;
    return -1;
}

MidiMap buildMidiMap (const std::vector<std::pair<juce::String, juce::String>>& slots, const MidiOverrides& overrides)
{
    MidiMap map;
    map.slotIndexForNote.fill (-1);
    std::vector<int> notes (slots.size(), -1);
    std::set<int> used;
    // 1. Overrides, first come first served for duplicates.
    for (size_t i = 0; i < slots.size(); ++i)
    {
        const auto it = overrides.find (slots[i].first);
        if (it != overrides.end() && it->second >= 0 && it->second < 128 && used.insert (it->second).second)
            notes[i] = it->second;
    }
    // 2. General MIDI by slot id, then by category.
    const auto& gm = gmNotes();
    for (size_t i = 0; i < slots.size(); ++i)
    {
        if (notes[i] >= 0)
            continue;
        auto it = gm.find (slots[i].first);
        if (it == gm.end())
            it = gm.find (slots[i].second);
        if (it != gm.end() && used.insert (it->second).second)
            notes[i] = it->second;
    }
    // 3. Lowest free note from 36 (C1) upward, wrapping below.
    for (size_t i = 0; i < slots.size(); ++i)
    {
        if (notes[i] >= 0)
            continue;
        for (int k = 0; k < 128; ++k)
        {
            const int n = (36 + k) % 128;
            if (used.insert (n).second)
            {
                notes[i] = n;
                break;
            }
        }
    }
    for (size_t i = 0; i < slots.size(); ++i)
    {
        map.slotNotes.emplace_back (slots[i].first, notes[i]);
        if (notes[i] >= 0)
            map.slotIndexForNote[(size_t) notes[i]] = (int) i;
    }
    return map;
}

MidiMap buildMidiMap (const KitManifest& kit, const MidiOverrides& overrides)
{
    std::vector<std::pair<juce::String, juce::String>> slots;
    for (const auto& s : kit.slots)
        slots.emplace_back (s.id, s.category);
    return buildMidiMap (slots, overrides);
}

juce::String midiNoteName (int note)
{
    static const char* names[] = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };
    if (note < 0 || note > 127)
        return "-";
    return juce::String (names[note % 12]) + juce::String (note / 12 - 2);
}
} // namespace drums
