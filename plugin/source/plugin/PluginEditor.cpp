#include "PluginEditor.h"
#include "WebZoom.h"
#include "core/Json.h"

namespace drums
{
namespace
{
    // Smallest usable panel in CSS pixels: below this the phone layout's keys overlap.
    constexpr int minCssWidth = 380, minCssHeight = 680;

    juce::WebBrowserComponent::Options baseOptions()
    {
        using Options = juce::WebBrowserComponent::Options;
        auto o = Options {}
#if JUCE_WINDOWS
                     .withBackend (Options::Backend::webview2)
                     .withWinWebView2Options (Options::WinWebView2 {}
                                                  .withUserDataFolder (juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("V.D.V.M WebView2"))
                                                  .withBackgroundColour (juce::Colour (0xff262525)))
#endif
            ;
        return o;
    }
} // namespace

DrumsEditor::DrumsEditor (DrumsProcessor& p) : AudioProcessorEditor (p), processor (p), bridge (p)
{
    // Read the saved size first: setting limits resizes the empty editor, and resized() records the size.
    const int width = processor.editorWidth, height = processor.editorHeight;
    previousScale = processor.editorScale;
    bridge.onSetView = [this] (const juce::var& request) { return setView (request); };
    bridge.getView = [this] { return viewJson(); };
    browser = std::make_unique<juce::WebBrowserComponent> (bridge.options (baseOptions()));
    bridge.attach (browser.get());
    addAndMakeVisible (*browser);
    setResizable (true, true);
    applyLimits();
    const double s = processor.editorScale;
    setSize (std::max ((int) (minCssWidth * s), width), std::max ((int) (minCssHeight * s), height));
    browser->goToURL (Bridge::startUrl());
    // The web view's native view appears once the window is on screen; zoom is applied then.
    startTimer (100);
}

DrumsEditor::~DrumsEditor()
{
    processor.emit = nullptr;
}

void DrumsEditor::applyLimits()
{
    const double s = processor.editorScale;
    setResizeLimits ((int) std::lround (minCssWidth * s), (int) std::lround (minCssHeight * s), 3200, 2200);
}

void DrumsEditor::applyZoom()
{
    zoomApplied = setWebViewZoom (*this, processor.editorScale);
}

void DrumsEditor::timerCallback()
{
    if (! nativeWebViewZoomAvailable())
    {
        stopTimer();
        return;
    }
    applyZoom();
    if (zoomApplied)
        stopTimer();
}

juce::var DrumsEditor::viewJson() const
{
    auto o = makeObject();
    setProp (o, "layout", processor.editorLayout);
    setProp (o, "scale", processor.editorScale);
    setProp (o, "nativeZoom", nativeWebViewZoomAvailable());
    return o;
}

juce::var DrumsEditor::setView (const juce::var& request)
{
    if (request.hasProperty ("scale"))
        processor.editorScale = std::clamp ((double) request["scale"], 0.5, 1.5);
    const bool presetChosen = request.hasProperty ("layout");
    if (presetChosen)
        processor.editorLayout = request["layout"].toString() == "compact" ? "compact" : "wide";
    applyLimits();
    if (presetChosen || request.hasProperty ("scale"))
    {
        // A preset sets the window to its size at the new zoom; a zoom change alone keeps the same
        // CSS-pixel viewport, so the layout does not jump between wide and compact.
        juce::Point<double> css;
        if (presetChosen)
            css = viewBaseSize (processor.editorLayout).toDouble();
        else
            css = { getWidth() / previousScale, getHeight() / previousScale };
        setSize ((int) std::lround (css.x * processor.editorScale), (int) std::lround (css.y * processor.editorScale));
    }
    previousScale = processor.editorScale;
    applyZoom();
    auto patch = makeObject();
    setProp (patch, "viewScale", processor.editorScale);
    setProp (patch, "viewLayout", processor.editorLayout);
    processor.prefs().merge (patch);
    return viewJson();
}

void DrumsEditor::resized()
{
    browser->setBounds (getLocalBounds());
    processor.editorWidth = getWidth();
    processor.editorHeight = getHeight();
}

void DrumsEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff262525));
}
} // namespace drums
