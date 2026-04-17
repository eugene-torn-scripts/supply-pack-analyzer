# Supply Pack Analyzer — Torn forum post

Paste the HTML below into a Torn forum post (Tools & Userscripts subforum). The
screenshot URLs are the Torn-editor URLs already in use; replace them if you
re-upload.

---

```html
<p style="text-align: center;">
  <span style="font-size: 22px;"><strong>📦 Supply Pack Analyzer</strong></span> <br /><span style="font-size: 14px;"
    ><em>Know if you're winning or losing</em></span
  >
</p>
<p>&nbsp;</p>
<p>
  Tired of opening hundreds of Zip Wallets and <em>wondering</em> if you're actually making money? Same. I built a
  script that hooks into your Torn logs and tells you exactly how your supply pack gambling is going &mdash; the real
  numbers, not the "I think I'm up" feeling.
</p>
<p>&nbsp;</p>
<hr />
<p>&nbsp;</p>
<p>
  <span style="font-size: 16px;"><strong>🎯 What it tracks</strong></span>
</p>
<p>&nbsp;</p>
<ul>
  <li>Every pack you <strong>buy</strong> and <strong>open</strong> &mdash; automatically via API</li>
  <li>Drop rates for every item</li>
  <li><strong>Profit/loss</strong> and <strong>ROI</strong> per pack type</li>
  <li><strong>Expected Value (EV)</strong> &mdash; the max price you should pay before it becomes a loss</li>
  <li>Best purchase source &mdash; Item Market vs Bazaar price comparison</li>
</ul>
<p>&nbsp;</p>
<p>
  <span style="font-size: 16px;"><strong>🎰 Who is this for?</strong></span>
</p>
<p>&nbsp;</p>
<p>
  If you gamble on supply packs &mdash; wallets, caches, drug packs, stash boxes, whatever &mdash; and you want to know
  if you're actually profiting or just burning cash, this is for you.
</p>
<p>&nbsp;</p>
<blockquote><strong>Stop guessing. Start knowing.</strong></blockquote>
<p>&nbsp;</p>
<hr />
<p>&nbsp;</p>
<p>
  <span style="font-size: 16px;"><strong>📊 Dashboard</strong></span>
</p>
<p>&nbsp;</p>
<p>See your total spent, total value, P&amp;L, and ROI at a glance. Click any pack to drill into details.</p>
<p>&nbsp;</p>
<p>
  <a href="https://editor.torn.com/bb181f60-2b89-4e4d-a4c3-c4edb205db54-4192025.png" target="_blank" rel="noopener"
    ><img
      src="https://editor.torn.com/bb181f60-2b89-4e4d-a4c3-c4edb205db54-4192025.png"
      alt="bb181f60-2b89-4e4d-a4c3-c4edb205db54-4192025.png"
      width="436"
      height="344"
  /></a>
</p>
<p>&nbsp;</p>
<p>
  <span style="font-size: 16px;"><strong>🔍 Pack Detail</strong></span>
</p>
<p>&nbsp;</p>
<ul>
  <li>Full breakdown for each of the <strong>39 supported pack types</strong></li>
  <li>EV and break-even price</li>
  <li>Loot table with drop rates, unit prices, and value contribution per pack</li>
  <li>Cash drops listed alongside items</li>
</ul>
<p>&nbsp;</p>
<p>
  <a href="https://editor.torn.com/6f60c8d4-d45a-411d-9afc-dc40ee64731c-4192025.png" target="_blank" rel="noopener"
    ><img
      src="https://editor.torn.com/6f60c8d4-d45a-411d-9afc-dc40ee64731c-4192025.png"
      alt="6f60c8d4-d45a-411d-9afc-dc40ee64731c-4192025.png"
      width="437"
      height="470"
  /></a>
</p>
<p>&nbsp;</p>
<p>
  <span style="font-size: 16px;"><strong>🧠 Smart cost model</strong></span>
</p>
<p>&nbsp;</p>
<ul>
  <li>Only counts packs you actually <strong>opened</strong> &mdash; resold packs don't inflate your cost</li>
  <li>Traded or gifted packs are valued at your average buy price</li>
  <li>Tracks purchases from both Item Market and Bazaar</li>
</ul>
<p>&nbsp;</p>
<hr />
<p>&nbsp;</p>
<p>
  <span style="font-size: 16px;"><strong>⚡ Setup &mdash; 30 seconds</strong></span>
</p>
<p>&nbsp;</p>
<ol>
  <li>Install the script (link below)</li>
  <li>Click the 📦 button in your footer bar</li>
  <li>Go to Settings &rarr; paste your <strong>Full Access</strong> API key</li>
  <li>Hit <strong>Sync</strong> &mdash; done</li>
</ol>
<p>
  <a class="full" href="https://editor.torn.com/41f5fbbf-a11b-478d-bfd9-9fbed61929f3-4192025.png" rel="page_thread"
    ><img
      src="https://editor.torn.com/41f5fbbf-a11b-478d-bfd9-9fbed61929f3-4192025.png"
      alt="41f5fbbf-a11b-478d-bfd9-9fbed61929f3-4192025.png"
      width="435"
      height="68"
  /></a>
</p>
<p>
  <a href="https://editor.torn.com/39833343-7d03-4376-a68e-d80e464bc654-4192025.png" target="_blank" rel="noopener"
    ><img
      src="https://editor.torn.com/39833343-7d03-4376-a68e-d80e464bc654-4192025.png"
      alt="39833343-7d03-4376-a68e-d80e464bc654-4192025.png"
      width="435"
      height="727"
  /></a>
</p>
<p>&nbsp;</p>
<p>
  <span style="font-size: 16px;"><strong>🔒 Privacy</strong></span>
</p>
<p>&nbsp;</p>
<p>
  Your API key <strong>never leaves your browser</strong>. It's stored locally and only sent directly to Torn's official
  API. No third-party servers. No data collection. Everything runs in your browser.
</p>
<p>&nbsp;</p>
<hr />
<p>&nbsp;</p>
<p style="text-align: center;">
  <span style="font-size: 18px;">
    <strong
      ><a
        href="https://greasyfork.org/scripts/573251-supply-pack-analyzer/code/Supply%20Pack%20Analyzer.user.js"
        target="_blank"
        rel="noopener"
        >⬇️ Install from Greasyfork</a
      ></strong
    >
  </span>
</p>
<p>&nbsp;</p>
<p style="text-align: center;">
  <em>Works with Tampermonkey, Violentmonkey, or compatible userscript managers.</em> <br /><em
    >Feedback and suggestions welcome &mdash; reply here or message me in-game.</em
  >
</p>
```
