// The V.D.V.M AudioProcessor: host parameters, host transport and MIDI into
// the realtime Instrument, project state, and the non-realtime services the
// editor's bridge uses (libraries, patterns, preferences). One plugin ID for
// both editions; installers only decide whether a factory library exists.
#pragma once

#include "core/Importer.h"
#include "core/Library.h"
#include "core/Playback.h"
#include "core/SampleStore.h"
#include "core/Session.h"
#include "core/Stores.h"

#include <juce_audio_processors/juce_audio_processors.h>

namespace drums
{
class DrumsProcessor final : public juce::AudioProcessor, private juce::Timer, private juce::AudioProcessorValueTreeState::Listener
{
public:
    DrumsProcessor();
    ~DrumsProcessor() override;

    // --- AudioProcessor ------------------------------------------------------------
    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using AudioProcessor::processBlock;
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 2.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}
    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    // --- services for the editor (message thread) --------------------------------------
    Session& session() { return *sessionPtr; }
    LibraryManager& libraries() { return libraryManager; }
    SampleStore& sampleStore() { return store; }
    Instrument& instrument() { return instrumentCore; }
    PatternStore& patterns() { return patternStore; }
    PrefsStore& prefs() { return prefsStore; }
    juce::AudioProcessorValueTreeState& parameters() { return apvts; }
    std::mutex& libraryWrites() { return libraryWriteMutex; }

    /** Pattern edited in the UI: mirror its automatable fields into the parameters, then play it. */
    void applyPatternFromUi (const PatternState& p);
    void setOutputDb (double db);
    void setHostSync (bool on);
    void transportCommand (const juce::String& command);
    void audition (const juce::String& slotId, int step);
    void preview (SamplePtr data);

    /** The library the UI browses (its catalog base). */
    juce::String browseLibraryId() const { return browseLibrary; }
    void setBrowseLibrary (const juce::String& id);

    /** Events for the editor: name and payload. Set by the editor while it exists. */
    std::function<void (const juce::String& event, const juce::var& payload)> emit;
    /** Tell the UI that the pattern or kit changed outside it. */
    void emitExternalChange();
    juce::var statusJson() const;
    juce::var librariesJson();

    /** Window size in screen pixels, page zoom, and the size preset last chosen ("wide" or "compact"). */
    int editorWidth = 868, editorHeight = 616;
    double editorScale = 0.7;
    juce::String editorLayout = "wide";
    /** False once the processor is gone; captured by deferred work. */
    std::shared_ptr<std::atomic<bool>> alive = std::make_shared<std::atomic<bool>> (true);

private:
    void timerCallback() override;
    void parameterChanged (const juce::String& id, float value) override;
    void syncParamsToPattern();
    void bootDefaultKit();
    static juce::AudioProcessorValueTreeState::ParameterLayout createLayout();

    LibraryManager libraryManager;
    SampleStore store;
    Instrument instrumentCore;
    std::unique_ptr<Session> sessionPtr;
    PatternStore patternStore;
    PrefsStore prefsStore;
    juce::AudioProcessorValueTreeState apvts;
    std::mutex libraryWriteMutex;

    std::atomic<float>* pOutput = nullptr;
    std::atomic<float>* pSwing = nullptr;
    std::atomic<float>* pPitch = nullptr;
    std::atomic<float>* pBpm = nullptr;
    std::atomic<float>* pSync = nullptr;
    std::atomic<float>* pRun = nullptr;
    std::array<std::atomic<float>*, automatablePads> pPads {};

    std::atomic<bool> paramsDirty { false };
    bool applyingFromUi = false;
    bool stateRestored = false;
    juce::String browseLibrary;
    double preparedRate = 0;
    int lastPlayhead = -2;
    bool lastPlaying = false;
    double lastHostTempo = -1;
    juce::String lastStatus;

    struct HeldPreview
    {
        SamplePtr data;
        juce::uint64 seq;
    };
    std::vector<HeldPreview> previews;
    juce::uint64 previewSeq = 0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (DrumsProcessor)
};

/** Unscaled (CSS pixel) window size of each preset: wide keeps the desktop panel, compact the phone panel. */
inline juce::Point<int> viewBaseSize (const juce::String& layout)
{
    return layout == "compact" ? juce::Point<int> { 420, 900 } : juce::Point<int> { 1240, 880 };
}

/** Pad gain parameter value (dB, -37 = off) to track gain and back. */
inline double padParamToGain (float v) { return v <= -36.75f ? -INFINITY : (double) v; }
inline float gainToPadParam (double db) { return std::isfinite (db) ? (float) std::clamp (db, -36.0, 6.0) : -37.0f; }
} // namespace drums
