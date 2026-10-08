// Windows and Linux: no native page zoom through JUCE's web view; the UI uses CSS zoom.
#include "WebZoom.h"

#if ! JUCE_MAC
namespace drums
{
bool setWebViewZoom (juce::Component&, double) { return false; }
bool nativeWebViewZoomAvailable() { return false; }
} // namespace drums
#endif
