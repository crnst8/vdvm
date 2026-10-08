// The WebView bridge: native functions the React UI calls, events it listens
// to, and the resource provider that serves the UI bundle and library files
// (catalog JSON, logos, photos) under /lib/<libraryId>/. Runs on the message
// thread; disk-heavy work goes to background threads and answers later.
#pragma once

#include "PluginProcessor.h"

#include <juce_gui_extra/juce_gui_extra.h>

namespace drums
{
class Bridge
{
public:
    explicit Bridge (DrumsProcessor& processor);
    ~Bridge();

    juce::WebBrowserComponent::Options options (juce::WebBrowserComponent::Options base);
    void attach (juce::WebBrowserComponent* browser);

    /** Set by the editor: window size preset and page zoom. */
    std::function<juce::var (const juce::var&)> onSetView;
    std::function<juce::var()> getView;

    /** First URL to load: the embedded UI, or a dev server when VDVM_UI_DEV_URL is set. */
    static juce::String startUrl();

private:
    using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;
    using Handler = std::function<void (const juce::var& arg, Completion done)>;

    void add (const char* name, Handler h);
    std::optional<juce::WebBrowserComponent::Resource> resource (const juce::String& path);
    void emit (const juce::String& event, const juce::var& payload);
    /** Run `work` on a background thread, then `then` on the message thread (skipped if the editor is gone). */
    void background (std::function<juce::var()> work, Completion done);
    void chooseFile (const juce::String& title, const juce::String& patterns, int flags, std::function<void (juce::Array<juce::File>)> then);
    void registerFunctions();

    DrumsProcessor& proc;
    juce::WebBrowserComponent* browser = nullptr;
    std::vector<std::pair<juce::String, Handler>> handlers;
    std::unique_ptr<juce::FileChooser> chooser;
    std::shared_ptr<std::atomic<bool>> alive = std::make_shared<std::atomic<bool>> (true);
    std::shared_ptr<std::atomic<bool>> cancelScan = std::make_shared<std::atomic<bool>> (false);
    std::map<int, ScanResult> scans;
    int nextScanId = 1;
};
} // namespace drums
