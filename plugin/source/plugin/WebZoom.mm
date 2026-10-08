// macOS: set WKWebView.pageZoom on the editor's web view. Page zoom changes the
// CSS pixel size, so the UI's width breakpoints see the zoomed viewport and the
// wide panel stays wide in a smaller window.
#include "WebZoom.h"

#import <WebKit/WebKit.h>

namespace drums
{
static WKWebView* findWebView (NSView* view)
{
    if ([view isKindOfClass:[WKWebView class]])
        return (WKWebView*) view;
    for (NSView* child in [view subviews])
        if (auto* found = findWebView (child))
            return found;
    return nil;
}

bool setWebViewZoom (juce::Component& editor, double zoom)
{
    auto* peer = editor.getPeer();
    if (peer == nullptr)
        return false;
    auto* root = (NSView*) peer->getNativeHandle();
    auto* webView = root != nil ? findWebView (root) : nil;
    if (webView == nil)
        return false;
    if (@available (macOS 11.0, *))
    {
        webView.pageZoom = zoom;
        return true;
    }
    return false;
}

bool nativeWebViewZoomAvailable() { return true; }
} // namespace drums
