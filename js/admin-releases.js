// js/admin-releases.js — Admin > Settings > Android app releases.
// Edits appConfig/android, which the Android app reads when it opens (core/AppConfig.kt):
//   latestVersionCode / latestVersionName / releaseNotes  -> the "Update" message
//   webUpdateUrl                                          -> where website installs go to update
//   minVersionCode                                        -> older versions must update first (0 = none)
//   testerNotice { enabled, belowVersionCode, title, message, playUrl, repeatHours }
// Shows what the live download serves (rehablix-ai.web.app/version.json). Only the admin account can save
// (database rules: appConfig is written by tolexar.ted@gmail.com only).
document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const card = $('androidReleaseCard');
  if (!card || !window.firebase) return;
  const ADMIN = 'tolexar.ted@gmail.com';
  const LIVE = 'https://rehablix-ai.web.app/version.json';
  const DEFAULT_URL = 'https://www.rehablix.com/download';
  let live = null;
  const msg = (t, ok) => { $('relMsg').textContent = t; $('relMsg').style.color = ok ? '#059669' : '#dc2626'; };
  const int = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 ? n : 0; };

  async function loadLive() {
    try {
      const r = await fetch(LIVE + '?t=' + Date.now(), { cache: 'no-store' });
      live = r.ok ? await r.json() : null;
    } catch (e) { live = null; }
    $('relLive').innerHTML = live
      ? 'Live download: <b>Rehablix ' + String(live.versionName) + '</b> (version code ' + int(live.versionCode) + ', ' + String(live.sizeMb) + ' MB, published ' + String(live.updated || '') + ')'
      : 'Could not read the live download right now.';
    $('relUseLive').disabled = !live;
  }

  async function load() {
    try {
      const v = (await firebase.database().ref('appConfig/android').once('value')).val() || {};
      const t = v.testerNotice || {};
      $('relCode').value = v.latestVersionCode || '';
      $('relName').value = v.latestVersionName || '';
      $('relNotes').value = v.releaseNotes || '';
      $('relUrl').value = v.webUpdateUrl || DEFAULT_URL;
      $('relMin').value = v.minVersionCode || 0;
      $('relTesterOn').checked = t.enabled === true;
      $('relTesterBelow').value = t.belowVersionCode || 0;
      $('relTesterTitle').value = t.title || 'Get the new Rehablix app';
      $('relTesterMsg').value = t.message || "This test version won't get updates any more. Please uninstall it, then download the new Rehablix app from rehablix.com/download. Your account and all your saved work stay exactly as they are.";
      $('relTesterUrl').value = t.playUrl || DEFAULT_URL;
      msg('', true);
    } catch (e) { msg('Could not load the release settings: ' + (e.message || e), false); }
  }

  $('relUseLive').addEventListener('click', () => {
    if (!live) return;
    $('relCode').value = int(live.versionCode);
    $('relName').value = String(live.versionName || '');
    msg('Filled in from the live download. Press Save to apply.', true);
  });

  $('relSave').addEventListener('click', async () => {
    const code = int($('relCode').value), min = int($('relMin').value), below = int($('relTesterBelow').value);
    const url = $('relUrl').value.trim() || DEFAULT_URL, tUrl = $('relTesterUrl').value.trim() || DEFAULT_URL;
    if (!code) return msg('Enter the latest version code (a whole number such as 4).', false);
    if (!/^https:\/\//.test(url) || !/^https:\/\//.test(tUrl)) return msg('Links must start with https://', false);
    if (min > code) return msg('"Must-update below" cannot be higher than the latest version.', false);
    if (live && code > int(live.versionCode)) {
      if (!confirm('The live download is version ' + int(live.versionCode) + ', but you set ' + code + '. Users would be told to update to a version that is not published yet. Save anyway?')) return;
    }
    if (min > 0 && !confirm('Versions below ' + min + ' will be blocked until they update. Continue?')) return;
    const btn = $('relSave');
    btn.disabled = true;
    try {
      await firebase.database().ref('appConfig/android').update({
        latestVersionCode: code,
        latestVersionName: $('relName').value.trim(),
        releaseNotes: $('relNotes').value.trim(),
        webUpdateUrl: url,
        minVersionCode: min,
        testerNotice: {
          enabled: $('relTesterOn').checked, belowVersionCode: below,
          title: $('relTesterTitle').value.trim(), message: $('relTesterMsg').value.trim(), playUrl: tUrl, repeatHours: 6,
        },
        updatedAt: Date.now(),
      });
      msg('✅ Saved. Android users see it the next time they open the app.', true);
    } catch (e) {
      msg('Not saved: ' + (e.message || e) + '. Make sure you are signed in as the admin account.', false);
    } finally { btn.disabled = false; }
  });

  firebase.auth().onAuthStateChanged((u) => { if (u && u.email === ADMIN) { load(); loadLive(); } });
});
