// The plugin window: the React UI in a WebView (WKWebView on macOS, WebView2
// on Windows, WebKitGTK on Linux). Resizable; its size, page zoom and size
// preset are kept with the project.
#pragma once

#include "Bridge.h"
#include "PluginProcessor.h"

namespace drums
{
class DrumsEditor final : public juce::AudioProcessorEditor, private juce::Timer
{
public:
    explicit DrumsEditor (DrumsProcessor&);
    ~DrumsEditor() override;

    void resized() override;
    void paint (juce::Graphics&) override;

    /** Apply a size preset ("wide" / "compact") and page zoom; resizes the window to the preset. */
    juce::var setView (const juce::var& request);
    juce::var viewJson() const;

private:
    void timerCallback() override;
    void applyZoom();
    void applyLimits();

    DrumsProcessor& processor;
    Bridge bridge;
    std::unique_ptr<juce::WebBrowserComponent> browser;
    bool zoomApplied = false;
    double previousScale = 1.0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (DrumsEditor)
};
} // namespace drums
