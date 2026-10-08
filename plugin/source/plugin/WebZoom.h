// Page zoom for the editor's web view. Native on macOS (WebZoom.mm); elsewhere
// the UI applies CSS zoom itself (WebZoomOther.cpp reports no native zoom).
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

namespace drums
{
/** True when applied; false while the web view does not exist yet. */
bool setWebViewZoom (juce::Component& editor, double zoom);
bool nativeWebViewZoomAvailable();
} // namespace drums
