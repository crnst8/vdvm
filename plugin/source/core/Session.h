// The instrument's state on the message thread: the pattern, the active kit
// and where it came from, MIDI note overrides, and kit loading. It turns that
// state into playback snapshots for the audio thread and into JSON for DAW
// projects and preset files. No audio-thread code lives here.
//
// Kit switches follow the browser transport: the chosen samples load into a
// staging pin; the new kit then takes over immediately when stopped, or at
// the next bar while playing; a request superseded by a newer one is ignored.
// A project whose library or kit cannot be found keeps its pattern and kit
// reference untouched and reports "missing" until the user locates it.
#pragma once

#include "Importer.h"
#include "Library.h"
#include "MidiMap.h"
#include "Pattern.h"
#include "Playback.h"
#include "SampleStore.h"

#include <functional>

namespace drums
{
struct KitReference
{
    juce::String libraryId, libraryKind, libraryName, pathHint;
    juce::String kitId, kitRevision, kitLabel, machineName;

    juce::var toJson() const;
    static KitReference fromJson (const juce::var& v);
    bool empty() const { return kitId.isEmpty(); }
};

enum class KitStatus { idle, loading, ready, error, missing };
juce::String toString (KitStatus s);

class Session
{
public:
    using Post = std::function<void (std::function<void()>)>;
    using Listener = std::function<void()>;

    Session (LibraryManager& libraries, SampleStore& store, Instrument& instrument, Post postToMessageThread);
    ~Session();

    // --- state ------------------------------------------------------------------
    const PatternState& pattern() const { return pat; }
    bool savedFlag() const { return saved; }
    const juce::String& selectedSlot() const { return selectedSlotId; }
    const KitReference& reference() const { return ref; }
    const std::optional<KitManifest>& kit() const { return activeKit; }
    std::shared_ptr<Library> library() const { return activeLibrary; }
    KitStatus status() const { return kitStatus; }
    const juce::String& error() const { return lastError; }
    std::pair<int, int> progress() const { return { progressDone, progressTotal }; }
    const juce::String& pendingKitId() const { return pendingKit; }
    MidiMap midiMap() const;
    const MidiOverrides& midiOverridesForKit() const;

    /** Change listeners run on the message thread after any state change. */
    void addListener (Listener l) { listeners.push_back (std::move (l)); }

    // --- edits ------------------------------------------------------------------
    /** Replace the pattern (UI edits). Republishes playback for the active kit. */
    void setPattern (const PatternState& p, bool notify = false);
    void setDraftMeta (bool savedNow, const juce::String& selected);
    void setMidiNote (const juce::String& slotId, int note);
    void resetMidiMap();

    using Completion = std::function<void (bool ok, const juce::String& error)>;
    /** Load a kit from a library and make it active (at the next bar while playing). */
    void selectKit (const juce::String& libraryId, const juce::String& kitId, Completion done);
    /** Decode one variant of the active kit before the UI selects it. */
    void prepareSample (const juce::String& sampleId, Completion done);
    bool isSampleReady (const juce::String& sampleId) const;
    /** Reload the active kit (after editing it, relinking, or a sample-rate change). */
    void reloadActiveKit (Completion done = {});

    // --- projects and presets ------------------------------------------------------
    juce::var toStateJson() const;
    /** Restore a saved state; loads the kit asynchronously. */
    void restoreStateJson (const juce::var& state, Completion done = {});
    juce::var toPresetJson() const;
    bool loadPresetJson (const juce::var& preset, juce::String& error, Completion done = {});

    /** Try the stored reference again (after adding or relocating a library). */
    void retryMissing (Completion done = {});

    /** Free retired snapshots and sample data. Call regularly on the message thread. */
    void collectGarbage();

    /** Block until no kit load is running (offline renders, tests). Returns false on timeout. */
    bool waitUntilLoaded (int timeoutMs) const;

private:
    void publish (bool atBar);
    void notify();
    void setStatus (KitStatus s, const juce::String& error = {});
    LoadRequest requestFor (const Library& lib, const Sample& s) const;
    void startLoad (std::shared_ptr<Library> lib, KitManifest kit, std::optional<PatternState> withPattern, Completion done);

    LibraryManager& libraries;
    SampleStore& store;
    Instrument& instrument;
    Post post;
    std::vector<Listener> listeners;

    PatternState pat;
    bool saved = false;
    juce::String selectedSlotId;
    KitReference ref;
    std::map<juce::String, MidiOverrides> midiOverrides; // per kit id
    std::optional<KitManifest> activeKit;
    std::shared_ptr<Library> activeLibrary;
    uint32_t kitTag = 0;
    uint32_t nextKitTag = 1;
    KitStatus kitStatus = KitStatus::idle;
    juce::String lastError, pendingKit;
    int progressDone = 0, progressTotal = 0;
    juce::uint64 generation = 0;
    std::shared_ptr<std::atomic<int>> loadsInFlight = std::make_shared<std::atomic<int>> (0);
    std::shared_ptr<bool> alive = std::make_shared<bool> (true);
};

inline constexpr const char* stateFormat = "vdvm-plugin-state";
inline constexpr const char* presetFormat = "vdvm-preset";
// Written before the product was named V.D.V.M; still read.
inline constexpr const char* legacyStateFormat = "drums-plugin-state";
inline constexpr const char* legacyPresetFormat = "drums-preset";
} // namespace drums
