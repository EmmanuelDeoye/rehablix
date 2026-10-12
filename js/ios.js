// js/ios.js — iPhone / iPad adjustments. Loaded first thing in <head> on every
// page, and does nothing at all on other devices.
//
// 1. Tapping a text box on iOS zooms the whole page in whenever the box's text
//    is smaller than 16px, and leaves it zoomed. Capping the automatic zoom
//    (maximum-scale=1) stops that; pinch-to-zoom keeps working, because iOS
//    ignores this cap for the user's own gestures.
// 2. Marks <html> with "ios" (and "ios-standalone" when opened from the Home
//    Screen) so css/main.css can apply the iOS-only rules.
(function () {
  var ua = navigator.userAgent || '';
  // iPadOS 13+ reports itself as a Mac; a Mac with a touch screen is an iPad.
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIOS) return;

  var root = document.documentElement;
  root.classList.add('ios');
  if (navigator.standalone === true) root.classList.add('ios-standalone');

  function capZoom() {
    var vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.setAttribute('name', 'viewport');
      (document.head || root).appendChild(vp);
    }
    vp.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1');
  }
  capZoom();
  // In case the tag comes later in the document than this script.
  document.addEventListener('DOMContentLoaded', capZoom);

  window.RehablixIsIOS = true;
})();
