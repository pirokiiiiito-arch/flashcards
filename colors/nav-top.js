/* Reset to the first color swatch on previous/next, even when a cached app
 * tries to restore the old scroll offset. No card data or editor state changes.
 */
(function () {
  'use strict';
  if (window.ColorCardNavTop) return;
  var anchor = document.getElementById('cardNavScrollAnchor');
  var controls = document.getElementById('cardNavigation');
  var study = document.getElementById('study');
  if (!anchor || !controls || !study) return;
  var frame = null;
  var followUp = null;
  var tail = document.createElement('div');
  tail.id = 'cardNavScrollTail';
  tail.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tail);

  function alignNavigation() {
    frame = null;
    if (study.classList.contains('hide') || !anchor.isConnected) return;
    // A short filtered card may need a little extra bottom room to reach y=0.
    tail.style.height = '0px';
    var doc = document.scrollingElement || document.documentElement;
    var y = window.scrollY || doc.scrollTop || 0;
    var target = Math.max(0, Math.round(anchor.getBoundingClientRect().top + y));
    // scrollHeight is at least viewport height, even when the content is shorter.
    // The zero-height tail measures the real end of normal-flow content instead.
    var height = Math.max(0, tail.getBoundingClientRect().top + y);
    var viewport = window.innerHeight || document.documentElement.clientHeight;
    tail.style.height = Math.max(0, Math.ceil(target + viewport - height)) + 'px';
    // Instant alignment avoids moving the controls while a user clicks again.
    // 'auto' is standard in iOS Safari; 'instant' may be ignored by older clients.
    try { window.scrollTo({top: target, left: 0, behavior: 'auto'}); }
    catch (_) { window.scrollTo(0, target); }
  }
  function schedule() {
    if (frame !== null) cancelAnimationFrame(frame);
    if (followUp !== null) clearTimeout(followUp);
    // The app's click handler synchronously renders the next card first.
    frame = requestAnimationFrame(function () {
      alignNavigation();
      // A later pass wins over iOS scroll anchoring and older cached app handlers.
      followUp = setTimeout(function () {
        followUp = null;
        alignNavigation();
      }, 120);
    });
  }
  controls.addEventListener('click', function (event) {
    var button = event.target && event.target.closest ? event.target.closest('button') : null;
    if (!button || !controls.contains(button) || button.disabled) return;
    if (button.id !== 'flip' && button.id !== 'prev' && button.id !== 'next') return;
    schedule();
  });
  var observer = new MutationObserver(function () {
    if (study.classList.contains('hide')) {
      if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
      if (followUp !== null) { clearTimeout(followUp); followUp = null; }
      tail.style.height = '0px';
    }
  });
  observer.observe(study, {attributes: true, attributeFilter: ['class']});
  window.ColorCardNavTop = Object.freeze({version: '3.0.0', align: schedule, prevNext: 'align-card-top'});
})();
