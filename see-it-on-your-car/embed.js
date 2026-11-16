/* Vyro-Car store embed. Drop this on a product page to add a "See it on your car" button that opens
   the studio with that wheel preselected:

     <script src="https://YOUR-STUDIO-HOST/embed.js" data-wheel="vossen_hf6_3" async></script>

   data-wheel   catalog id, SKU, or the product URL handle (optional: defaults to the last part of the page URL,
                which matches Shopify product handles)
   data-label   button text (optional)
   data-target  CSS selector of the element to put the button in (optional: defaults to right after the script tag)
   The studio posts {type:'vyro:add-to-cart', wheel, url} to the page when the shopper clicks Add to cart. */
(function () {
  var s = document.currentScript, host = new URL(s.src).origin + new URL(s.src).pathname.replace(/embed\.js$/, '');
  var wheel = s.dataset.wheel || location.pathname.replace(/\/+$/, '').split('/').pop();
  var btn = document.createElement('button'); btn.type = 'button'; btn.textContent = s.dataset.label || 'See it on your car';
  btn.style.cssText = 'font:600 15px/1 system-ui,sans-serif;padding:13px 18px;border-radius:10px;border:0;background:#e8381a;color:#fff;cursor:pointer';
  var target = s.dataset.target && document.querySelector(s.dataset.target); if (target) target.appendChild(btn); else s.parentNode.insertBefore(btn, s.nextSibling);
  var wrap;
  function open() {
    if (!wrap) {
      wrap = document.createElement('div'); wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'See it on your car');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(10,12,16,.72);display:flex;align-items:center;justify-content:center;padding:max(12px,env(safe-area-inset-top)) 12px 12px';
      var box = document.createElement('div'); box.style.cssText = 'position:relative;width:min(1280px,100%);height:min(900px,100%);background:#fff;border-radius:14px;overflow:hidden';
      var f = document.createElement('iframe'); f.src = host + '?embed=1&wheel=' + encodeURIComponent(wheel); f.title = 'Vyro-Car wheel studio'; f.allow = 'clipboard-write'; f.style.cssText = 'width:100%;height:100%;border:0';
      var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
      x.style.cssText = 'position:absolute;top:8px;right:8px;width:36px;height:36px;border-radius:50%;border:0;background:rgba(17,19,24,.8);color:#fff;font-size:22px;line-height:1;cursor:pointer';
      x.onclick = close; wrap.onclick = function (e) { if (e.target === wrap) close(); };
      box.appendChild(f); box.appendChild(x); wrap.appendChild(box);
    }
    document.body.appendChild(wrap); document.documentElement.style.overflow = 'hidden';
  }
  function close() { if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap); document.documentElement.style.overflow = ''; btn.focus(); }
  btn.onclick = open; addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
})();
