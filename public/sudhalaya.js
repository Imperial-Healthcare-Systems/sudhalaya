/* ===================== Canonical host guard =====================
   The site is served on www.suddhalaya.com; the bare apex (suddhalaya.com)
   308-redirects there. If the browser lands on the apex, every /api call becomes
   a CROSS-ORIGIN apex→www redirect — and with fetch's default same-origin
   credentials the browser IGNORES the Set-Cookie on login and drops the auth
   cookie on reads. Result: admins & shoppers get bounced back to the login gate
   on every refresh. Force the canonical www host first so page + API share one
   origin. No-op on www, localhost, Vercel previews, or any other host. */
(function canonicalHost(){
  try{
    if(location.hostname==='suddhalaya.com'){
      location.replace('https://www.suddhalaya.com'+location.pathname+location.search+location.hash);
    }
  }catch(e){/* non-browser / blocked navigation — ignore */}
})();

const LOGO = "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/bd37ba1080a8bf4c.png";
/* exact-decimal money helpers (paise-accurate, float-safe) */
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* ===================== Backend data layer (Supabase via Next API) =====================
   When /api/bootstrap reports the backend is configured, catalog, auth and orders
   come from the server. Otherwise every path below falls back to the original
   localStorage behaviour, so the site still runs with no backend at all. */
let BACKEND = false;        // flipped true after a successful bootstrap
let BOOTED = false;         // flipped true once the first bootstrap attempt resolves (backend or offline)
let CURRENT_USER = null;    // cached signed-in shopper (keeps currentShopper() synchronous)
let MY_ORDERS = [];         // signed-in shopper's orders, fetched from the server
let COUPON_INFO = null;     // {type,value,desc} for a server-validated coupon (backend mode)
const SDB = {
  async _get(u){ const r=await fetch(u,{headers:{accept:'application/json'}}); return r.json(); },
  async _post(u,b){ const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})}); return r.json(); },
  bootstrap(){ return this._get('/api/bootstrap').catch(()=>({configured:false})); },
  signup(p){ return this._post('/api/auth/signup',p); },
  login(p){ return this._post('/api/auth/login',p); },
  logout(){ return this._post('/api/auth/logout',{}); },
  resetRequest(p){ return this._post('/api/auth/reset-request',p); },
  resetConfirm(p){ return this._post('/api/auth/reset-confirm',p); },
  placeOrder(p){ return this._post('/api/orders',p); },
  myOrders(){ return this._get('/api/orders').catch(()=>({orders:[]})); },
  validateCoupon(code,subtotal,items){ return this._post('/api/coupon', {code, subtotal, items:items||[]}).catch(()=>({valid:false})); },
  submitReview(p){ return this._post('/api/reviews', p).catch(()=>({ok:false})); },
  reviewImage(dataUrl){ return this._post('/api/review-image', {dataUrl}).catch(()=>({ok:false})); },
  trackShipment(awb){ return this._get('/api/shipment-track?awb='+encodeURIComponent(awb)).catch(()=>({ok:false})); },
  stockNotify(p){ return this._post('/api/stock-notify', p).catch(()=>({ok:false})); },
  postTrack(evt){ return this._post('/api/track', {evt}).catch(()=>({})); },
};
/* Admin/staff backend (Phase 2): auth + write-through. */
const SDBA = {
  session(){ return SDB._get('/api/admin/session').catch(()=>({staff:null})); },
  login(p){ return SDB._post('/api/admin/login', p); },
  logout(){ return SDB._post('/api/admin/logout', {}); },
  data(){ return SDB._get('/api/admin/data').catch(()=>({ok:false})); },
  inventory(variantId){ return SDB._get('/api/admin/inventory?variant_id='+variantId).catch(()=>({ok:false,batches:[],movements:[]})); },
  regionReport(from,to,group){ return SDB._get('/api/admin/report/region?from='+from+'&to='+to+'&group='+group).catch(()=>({ok:false,rows:[]})); },
  upload(dataUrl,filename){ return SDB._post('/api/admin/upload', {dataUrl, filename}).catch(()=>({ok:false})); },
  op(op, payload){ return SDB._post('/api/admin/op', {op, payload}).catch(e=>({ok:false,err:String(e)})); },
};
/* Load real operational data into the admin's in-memory collections. */
async function loadAdminData(){
  if(!BACKEND) return;
  const r=await SDBA.data();
  if(!r || !r.ok) return;
  if(Array.isArray(r.orders)) ORDERS=r.orders;
  if(Array.isArray(r.customers)) CUSTOMERS=r.customers;
  if(r.coupons && typeof r.coupons==='object') COUPONS=r.coupons;
  if(Array.isArray(r.returns)) RETURNS=r.returns;
  if(r.analytics && typeof r.analytics==='object'){ ANALYTICS.daily=r.analytics; ANALYTICS.__seeded=true; }
  if(Array.isArray(r.warehouses) && r.warehouses.length) WAREHOUSES=r.warehouses;
  if(r.pendingReviews) PENDING_REVIEWS={home:r.pendingReviews.home||[], product:r.pendingReviews.product||[]};
  if(r.publishedReviews) PUBLISHED_REVIEWS={home:r.publishedReviews.home||[], product:r.publishedReviews.product||[]};
  // load ALL products (incl. drafts/archived) so every product is manageable in admin;
  // the storefront filters out drafts (getVisible/onSearch), so this is safe.
  if(Array.isArray(r.products) && r.products.length){ PRODUCTS=r.products; PRODUCTS.forEach(syncProductFromVariants); }
}
/* Persist an admin mutation to the DB when the backend is on (no-op offline). */
function adminSync(op, payload){
  if(!BACKEND) return Promise.resolve({ok:true, offline:true});
  return SDBA.op(op, payload).then(r=>{ if(!r || !r.ok) toast('Sync failed: '+((r&&r.err)||op)); return r; });
}

/* ---------- SVG product illustration generator (self-contained, original) ---------- */
function prodSVG(type, c1, c2){
  const bg = `<rect width='400' height='400' fill='${c1}'/>`;
  const shapes = {
    jar:`<ellipse cx='200' cy='250' rx='95' ry='110' fill='${c2}'/><rect x='150' y='110' width='100' height='40' rx='6' fill='${c2}'/><rect x='160' y='95' width='80' height='22' rx='5' fill='#f1e9da'/><ellipse cx='200' cy='250' rx='70' ry='85' fill='rgba(255,255,255,.13)'/>`,
    bottle:`<rect x='165' y='140' width='70' height='180' rx='16' fill='${c2}'/><rect x='182' y='95' width='36' height='55' rx='6' fill='${c2}'/><rect x='178' y='85' width='44' height='18' rx='4' fill='#f1e9da'/><rect x='180' y='180' width='40' height='90' rx='8' fill='rgba(255,255,255,.15)'/>`,
    pouch:`<path d='M140 130 H260 V300 Q260 320 240 320 H160 Q140 320 140 300 Z' fill='${c2}'/><rect x='150' y='110' width='100' height='30' rx='4' fill='${c2}'/><rect x='165' y='170' width='70' height='90' rx='6' fill='rgba(255,255,255,.12)'/>`,
    box:`<rect x='135' y='140' width='130' height='150' rx='8' fill='${c2}'/><path d='M135 140 L200 110 L265 140 Z' fill='rgba(0,0,0,.12)'/><rect x='160' y='180' width='80' height='70' rx='5' fill='rgba(255,255,255,.12)'/>`,
  };
  const leaf = `<path d='M300 70 q40 5 35 50 q-45 5 -50 -35 q8 -12 15 -15' fill='#6f8f4e' opacity='.55'/>`;
  return `<svg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'>${bg}${leaf}${shapes[type]||shapes.jar}</svg>`;
}
function svgURI(svg){return "data:image/svg+xml;utf8,"+encodeURIComponent(svg);}

const REAL_IMAGES = {
  "CAT#A2 Dairy": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/f3af05a465c5958e.jpg",
  "CAT#Cold-Pressed Oils": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/9692803395cf4607.jpg",
  "CAT#Honey": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/c10f72364305abdf.jpg",
  "CAT#Spices": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/e0d7585245e3da29.jpg",
  "CAT#Staples": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/b4a8d5420858ab3f.jpg",
  "CAT#Staples & Spices": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/b4a8d5420858ab3f.jpg",
  "HERO#0": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/076af40c4b1c7d29.jpg",
  "SDL-ATTA#0": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/d3fa0678f87647b2.jpg",
  "SDL-ATTA#1": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/70042d8962590fca.jpg",
  "SDL-ATTA#2": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/13acd71a862c00ec.jpg",
  "SDL-GHEE#0": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/d330f2ef280fc167.jpg",
  "SDL-GHEE#1": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/eff52e02128925be.jpg",
  "SDL-GHEE#2": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/5fcf65ca61f2f9cf.jpg",
  "SDL-GHEE-BUF#0": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/56275b2aa5ac19f7.jpg",
  "SDL-GHEE-BUF#1": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/b26815994b62748d.jpg",
  "SDL-GHEE-BUF#2": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/f59c1eb34ef63782.jpg",
  "SDL-HONEY-CIN#0": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/06d688cc09f9d729.jpg",
  "SDL-HONEY-CIN#1": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/0d0098be0d7e73a7.jpg",
  "SDL-HONEY-CIN#2": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/01ef8ab05aa73bad.jpg",
  "SDL-HONEY-RAW#0": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/25f7afccadf4b1f5.jpg",
  "SDL-HONEY-RAW#1": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/bf4cb0fcb0bb541f.jpg",
  "SDL-HONEY-RAW#2": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/70a6d047995df9f3.jpg",
  "SDL-JAG#0": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/2090d609591bde89.jpg",
  "SDL-JAG#1": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/80a05536bd85f227.jpg",
  "SDL-JAG#2": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/97f5cd8b2fe925d6.jpg",
  "SDL-OIL-COCO#0": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/19586ac1dc5c49e7.jpg",
  "SDL-OIL-COCO#1": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/0c9c62843575cc2a.jpg",
  "SDL-OIL-COCO#2": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/60fd83adece9e770.jpg",
  "SDL-OIL-GNUT#0": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/a95ebd50f98f437c.jpg",
  "SDL-OIL-GNUT#1": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/e022fa4ae7ff5188.jpg",
  "SDL-OIL-GNUT#2": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/7a3f6b613fc53f4f.jpg",
  "SDL-OIL-MUST#0": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/b83fd6dbeeb2e575.jpg",
  "SDL-OIL-MUST#1": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/d99c7c23019920ac.jpg",
  "SDL-OIL-MUST#2": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/e7cabfd6389587eb.jpg",
  "SDL-OIL-MUST#3": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/4674386975c6eb98.jpg",
  "SDL-OIL-SES#0": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/e198260ceba09bed.jpg",
  "SDL-OIL-SES#1": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/885e5559c7377ff9.jpg",
  "SDL-OIL-SES#2": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/591fc59cab75d4cb.jpg",
  "SDL-SALT#0": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/35cb02c848c9f372.jpg",
  "SDL-SALT#1": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/fe0647e92d158280.jpg",
  "SDL-SALT#2": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/4b3c8dbd9b9740e0.jpg",
  "SDL-SPICE-TUR#0": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/58e2168841e731d4.jpg",
  "SDL-SPICE-TUR#1": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/0395e9de9f13d145.jpg",
  "SDL-SPICE-TUR#2": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/d47ed8bf17e188ab.jpg",
  "STORY#0": "https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/59c274f80045aea9.jpg",
};

/* ---- real product photography (swaps the SVG placeholders by SKU) ---- */
/* primaryImg: real photo for a product's first gallery view, else SVG */
function primaryImg(p){
  if(p && Array.isArray(p.imageUrls) && p.imageUrls.length) return p.imageUrls[0];  // uploaded photo wins
  const r = REAL_IMAGES[(p.sku||'')+'#0'];
  return r || svgURI(prodSVG(p.type,p.c1,p.c2));
}
/* catImg: admin-uploaded category image wins, else a built-in banner photo, else null */
function catImg(name){
  const c=(typeof CATEGORIES!=='undefined'?CATEGORIES:[]).find(x=>x.name===name);
  if(c && c.image) return c.image;
  return REAL_IMAGES['CAT#'+name] || null;
}


/* ---------- PRODUCT DATA (enriched: variants, gallery, specs, GST) ----------
   Each product carries:
   - variants[]  : {label, sku, price, mrp, stock}  (size/weight ladder)
   - content     : {origin, ingredients, usage, certifications, shelfLife, netWeight}
   - faqs[]      : per-product Q&A (also powers FAQ schema)
   - gst         : GST rate (%). Food staples 0-5%, processed 5-12%.
   The displayed price/mrp/stock are derived from the selected variant.
*/
let PRODUCTS = [
  {id:1, name:"A2 Desi Cow Ghee", cat:"A2 Dairy", rating:4.9, reviews:412, sku:"SDL-GHEE", tag:"Bestseller", type:"jar", c1:"#1f3520", c2:"#c9a85e", gst:5, hsn:"0405",
   amazonUrl:"https://www.amazon.in/s?k=a2+cow+ghee", shipFee:0,
   desc:"Hand-churned bilona ghee from grass-fed Gir cows. Golden, aromatic, and rich in natural nutrients — made the traditional Vedic way.",
   feats:["Bilona hand-churned method","From grass-fed Gir cows","No additives or preservatives","Glass-jar packed"],
   variants:[{label:"250 ml",sku:"SDL-GHEE-250",price:499,mrp:620,stock:30},{label:"500 ml",sku:"SDL-GHEE-500",price:899,mrp:1150,stock:48},{label:"1 L",sku:"SDL-GHEE-1L",price:1699,mrp:2150,stock:18}],
   content:{origin:"Single-origin Gir cow milk from partner farms in Gujarat",ingredients:"100% A2 cow milk butter (cultured curd, hand-churned)",usage:"Use for tempering, cooking, or a spoonful warm with meals. Store away from direct sunlight; no refrigeration needed.",certifications:"FSSAI licensed · Third-party lab report (purity & adulteration) on each batch",labUrl:"https://drive.google.com/drive/folders/sample-lab-reports",shelfLife:"12 months from manufacture",netWeight:"As per selected pack"},
   faqs:[{q:"Is this A2 ghee?",a:"Yes — made only from A2 milk of indigenous Gir cows using the bilona (hand-churn) method."},{q:"Does it need refrigeration?",a:"No. Store in a cool, dry place away from sunlight. Natural crystallisation in winter is normal."}]},

  {id:2, name:"Cold-Pressed Mustard Oil", cat:"Cold-Pressed Oils", rating:4.7, reviews:289, sku:"SDL-OIL-MUST", tag:"", type:"bottle", c1:"#2d3a14", c2:"#b08d3c", gst:5, hsn:"1514",
   desc:"Wood-pressed (kachi ghani) mustard oil with its natural pungency and aroma intact. Unrefined and chemical-free.",
   feats:["Wood-pressed kachi ghani","Unrefined & filtered","High in natural antioxidants","Glass bottle"],
   variants:[{label:"500 ml",sku:"SDL-OIL-MUST-500",price:340,mrp:420,stock:62},{label:"1 L",sku:"SDL-OIL-MUST-1L",price:640,mrp:790,stock:40}],
   content:{origin:"Mustard seeds sourced from Rajasthan farms",ingredients:"100% cold-pressed mustard oil",usage:"Ideal for Indian curries, pickles, and frying. Heat to smoking point once before first use as per tradition.",certifications:"FSSAI licensed · AGMARK grade · Lab-tested",shelfLife:"9 months from manufacture",netWeight:"As per selected pack"},
   faqs:[{q:"Is this edible-grade?",a:"Yes, it is food-grade kachi ghani mustard oil, FSSAI licensed."}]},

  {id:3, name:"Raw Forest Honey", cat:"Honey", rating:4.8, reviews:356, sku:"SDL-HONEY-RAW", tag:"Bestseller", type:"jar", c1:"#5a3d12", c2:"#c9a85e", gst:5, hsn:"0409", shipFee:40,
   desc:"Unprocessed, unheated wild honey harvested from forest beehives. Raw enzymes and pollen preserved.",
   feats:["100% raw & unheated","Wild forest sourced","No added sugar","NMR tested"],
   variants:[{label:"250 g",sku:"SDL-HONEY-250",price:329,mrp:400,stock:40},{label:"500 g",sku:"SDL-HONEY-500",price:549,mrp:680,stock:55}],
   content:{origin:"Wild forest beehives, Sundarbans & Western Ghats",ingredients:"100% raw honey",usage:"A spoonful daily, in warm (not hot) water, or over breakfast. Do not heat — it destroys natural enzymes.",certifications:"NMR tested · FSSAI licensed · No C4 sugar",shelfLife:"24 months",netWeight:"As per selected pack"},
   faqs:[{q:"Why has my honey crystallised?",a:"Natural crystallisation is a sign of pure, raw honey. Place the jar in warm water to liquefy."}]},

  {id:4, name:"Stone-Ground Whole Wheat Atta", cat:"Staples", rating:4.6, reviews:198, sku:"SDL-ATTA", tag:"", type:"pouch", c1:"#6b5a2e", c2:"#b08d3c", gst:5, hsn:"1101",
   desc:"Chakki-fresh whole wheat flour stone-ground in small batches to retain fibre, bran and natural wheat aroma.",
   feats:["Stone-ground chakki fresh","High fibre & bran retained","Single-origin wheat","No maida blend"],
   variants:[{label:"1 kg",sku:"SDL-ATTA-1KG",price:79,mrp:99,stock:120},{label:"5 kg",sku:"SDL-ATTA-5KG",price:299,mrp:360,stock:90}],
   content:{origin:"Single-origin wheat from Madhya Pradesh",ingredients:"100% whole wheat (sharbati)",usage:"Knead with water for soft rotis. Store airtight in a cool, dry place.",certifications:"FSSAI licensed",shelfLife:"3 months from milling",netWeight:"As per selected pack"},
   faqs:[{q:"Is maida added?",a:"No. This is 100% whole wheat with bran retained — no maida blend."}]},

  {id:5, name:"Cold-Pressed Coconut Oil", cat:"Cold-Pressed Oils", rating:4.8, reviews:241, sku:"SDL-OIL-COCO", tag:"", type:"bottle", c1:"#1f3520", c2:"#e8e2d0", gst:5, hsn:"1513",
   desc:"Virgin coconut oil cold-pressed from sun-dried copra. Multipurpose — cooking, skin and hair.",
   feats:["Virgin cold-pressed","Sun-dried copra","Multipurpose use","No bleaching"],
   variants:[{label:"250 ml",sku:"SDL-OIL-COCO-250",price:229,mrp:280,stock:48},{label:"500 ml",sku:"SDL-OIL-COCO-500",price:399,mrp:480,stock:48}],
   content:{origin:"Coconut from Kerala & Tamil Nadu groves",ingredients:"100% virgin coconut oil",usage:"Cook, or apply to skin and hair. Solidifies below 24°C — this is normal.",certifications:"FSSAI licensed · Lab-tested",shelfLife:"18 months",netWeight:"As per selected pack"},
   faqs:[{q:"Why has it gone solid?",a:"Coconut oil naturally solidifies below 24°C. Warm the bottle to liquefy."}]},

  {id:6, name:"Himalayan Pink Rock Salt", cat:"Staples", rating:4.7, reviews:167, sku:"SDL-SALT", tag:"", type:"pouch", c1:"#7a3f3a", c2:"#c9a85e", gst:0, hsn:"2501",
   desc:"Hand-mined unrefined pink salt rich in trace minerals. Coarse and fine grind available.",
   feats:["Hand-mined & unrefined","84 trace minerals","No anti-caking agents","Resealable pouch"],
   variants:[{label:"1 kg",sku:"SDL-SALT-1KG",price:189,mrp:240,stock:120},{label:"500 g (Fine)",sku:"SDL-SALT-500F",price:109,mrp:140,stock:80}],
   content:{origin:"Khewra salt range, hand-mined",ingredients:"100% Himalayan pink rock salt",usage:"Everyday cooking, finishing, or brining. Store dry.",certifications:"FSSAI licensed",shelfLife:"Best before 36 months",netWeight:"As per selected pack"},
   faqs:[{q:"Is it iodised?",a:"No, this is natural unrefined rock salt with no additives."}]},

  {id:7, name:"Organic Jaggery Powder", cat:"Staples", rating:4.6, reviews:143, sku:"SDL-JAG", tag:"", type:"pouch", c1:"#6b4a1e", c2:"#b08d3c", gst:5, hsn:"1701",
   desc:"Chemical-free jaggery powder made from organic sugarcane. A wholesome natural sweetener.",
   feats:["Chemical-free processing","Organic sugarcane","No sulphur","Fine dissolvable powder"],
   variants:[{label:"500 g",sku:"SDL-JAG-500",price:159,mrp:200,stock:34},{label:"1 kg",sku:"SDL-JAG-1KG",price:299,mrp:370,stock:24}],
   content:{origin:"Organic sugarcane from Maharashtra",ingredients:"100% sugarcane jaggery",usage:"Use 1:1 to replace sugar in tea, sweets, and baking.",certifications:"FSSAI licensed · No sulphur",shelfLife:"12 months",netWeight:"As per selected pack"},
   faqs:[{q:"Does it contain sulphur?",a:"No. It is processed without sulphur or chemical clarifiers."}]},

  {id:8, name:"A2 Buffalo Ghee", cat:"A2 Dairy", rating:4.7, reviews:201, sku:"SDL-GHEE-BUF", tag:"", type:"jar", c1:"#15241a", c2:"#e8e2d0", gst:5, hsn:"0405",
   desc:"Creamy bilona buffalo ghee with a rich mouthfeel, slow-cooked for depth and aroma.",
   feats:["Bilona method","Grass-fed buffalo milk","Rich & creamy","Glass-jar packed"],
   variants:[{label:"500 ml",sku:"SDL-GHEE-BUF-500",price:799,mrp:990,stock:22},{label:"1 L",sku:"SDL-GHEE-BUF-1L",price:1499,mrp:1850,stock:40}],
   content:{origin:"Grass-fed buffalo milk from partner dairies",ingredients:"100% buffalo milk butter (hand-churned)",usage:"Rich for sweets and slow cooking. Store cool and dry.",certifications:"FSSAI licensed · Lab-tested",shelfLife:"12 months",netWeight:"As per selected pack"},
   faqs:[{q:"How is this different from cow ghee?",a:"Buffalo ghee is creamier and richer; cow ghee is lighter and more aromatic."}]},

  {id:9, name:"Cold-Pressed Groundnut Oil", cat:"Cold-Pressed Oils", rating:4.7, reviews:176, sku:"SDL-OIL-GNUT", tag:"", type:"bottle", c1:"#5a4a1e", c2:"#c9a85e", gst:5, hsn:"1508",
   desc:"Nutty, flavourful groundnut oil wood-pressed and naturally filtered. Ideal for everyday Indian cooking.",
   feats:["Wood-pressed","Naturally filtered","High smoke point","Unrefined"],
   variants:[{label:"500 ml",sku:"SDL-OIL-GNUT-500",price:365,mrp:450,stock:55},{label:"1 L",sku:"SDL-OIL-GNUT-1L",price:689,mrp:850,stock:30}],
   content:{origin:"Groundnut from Gujarat & Andhra farms",ingredients:"100% groundnut oil",usage:"Great for deep-frying and everyday cooking thanks to its high smoke point.",certifications:"FSSAI licensed",shelfLife:"9 months",netWeight:"As per selected pack"},
   faqs:[{q:"Is it refined?",a:"No, it is unrefined wood-pressed oil, naturally filtered only."}]},

  {id:10, name:"Wild Honey & Cinnamon Spread", cat:"Honey", rating:4.8, reviews:98, sku:"SDL-HONEY-CIN", tag:"New", type:"jar", c1:"#5a3d12", c2:"#b08d3c", gst:5, hsn:"0409",
   desc:"Raw honey infused with hand-ground Ceylon cinnamon — a warming spread for mornings.",
   feats:["Raw infused honey","Ceylon cinnamon","No preservatives","Small-batch"],
   variants:[{label:"250 g",sku:"SDL-HONEY-CIN-250",price:449,mrp:560,stock:18}],
   content:{origin:"Wild honey + Ceylon cinnamon",ingredients:"Raw honey, ground Ceylon cinnamon",usage:"Spread on toast or stir into warm milk. Do not overheat.",certifications:"FSSAI licensed",shelfLife:"18 months",netWeight:"250 g"},
   faqs:[{q:"Is the cinnamon Ceylon or cassia?",a:"True Ceylon cinnamon, hand-ground in small batches."}]},

  {id:11, name:"Organic Turmeric Powder", cat:"Spices", rating:4.9, reviews:312, sku:"SDL-SPICE-TUR", tag:"Bestseller", type:"box", c1:"#7a5410", c2:"#c9a85e", gst:5, hsn:"0910",
   desc:"High-curcumin Lakadong turmeric, sun-dried and stone-ground. Deep colour, earthy aroma.",
   feats:["Lakadong high-curcumin","Sun-dried & stone-ground","Lab-tested purity","No colour added"],
   variants:[{label:"100 g",sku:"SDL-SPICE-TUR-100",price:199,mrp:260,stock:76},{label:"250 g",sku:"SDL-SPICE-TUR-250",price:449,mrp:560,stock:40}],
   content:{origin:"Lakadong turmeric from Meghalaya",ingredients:"100% turmeric (Curcuma longa)",usage:"For cooking, golden milk, or face packs. A little goes a long way.",certifications:"FSSAI licensed · High-curcumin lab report",shelfLife:"24 months",netWeight:"As per selected pack"},
   faqs:[{q:"What is the curcumin content?",a:"Lakadong turmeric typically tests 7%+ curcumin, well above commodity turmeric."}]},

  {id:12, name:"Cold-Pressed Sesame Oil", cat:"Cold-Pressed Oils", rating:4.6, reviews:121, sku:"SDL-OIL-SES", tag:"", type:"bottle", c1:"#5a4a1e", c2:"#e8e2d0", gst:5, hsn:"1515",
   desc:"Aromatic til oil wood-pressed from premium sesame seeds. Traditional and unrefined.",
   feats:["Wood-pressed","Premium sesame seeds","Unrefined","Rich aroma"],
   variants:[{label:"500 ml",sku:"SDL-OIL-SES-500",price:355,mrp:430,stock:41},{label:"1 L",sku:"SDL-OIL-SES-1L",price:669,mrp:820,stock:22}],
   content:{origin:"Sesame from Tamil Nadu farms",ingredients:"100% sesame (til) oil",usage:"For South Indian cooking, tempering, and oil pulling.",certifications:"FSSAI licensed",shelfLife:"9 months",netWeight:"As per selected pack"},
   faqs:[{q:"Is this toasted sesame oil?",a:"No, this is raw cold-pressed sesame oil, not the toasted East-Asian style."}]},
];

/* Normalise: derive top-level price/mrp/stock from the first variant so existing
   storefront code keeps working, and attach helper accessors. */
// Stock never goes below 0: clamp each variant so a stray negative can't drag the total negative.
function variantTotalStock(p){return ((p&&p.variants)||[]).reduce((s,v)=>s+Math.max(0,v.stock||0),0);}
function syncProductFromVariants(p){
  if(!p||!p.variants||!p.variants.length) return;
  // top-level reflects the cheapest in-stock variant (or first) for card display
  const inStock=p.variants.filter(v=>v.stock>0);
  const base=(inStock[0]||p.variants[0]);
  p.price=base.price; p.mrp=base.mrp; p.stock=variantTotalStock(p);
  const _lt=lowThreshold(p);
  if(p.tag==="Low Stock" || (_lt>0 && variantTotalStock(p)>0 && variantTotalStock(p)<=_lt && !p.tag)) p.tag=p.tag||"Low Stock";
}
PRODUCTS.forEach(syncProductFromVariants);

/* =====================================================================
   CUSTOMER REVIEWS  (brief §"Customer reviews")
   ---------------------------------------------------------------------
   • REVIEWS_ENABLED is a single feature flag that shows/hides the whole
     homepage "What Our Customers Say" section. Flip it to false (or set
     localStorage 'sdl_reviews_enabled' = 'false') to hide instantly.
   • Reviews can be submitted WITHOUT a purchase — both on the homepage
     and on each product page. Homepage submissions are general; product
     submissions attach to that product.
   • Everything persists to localStorage, consistent with cart/admin data,
     so reviews survive a refresh (in production this maps to a DB table).
   ===================================================================== */
const REVIEWS_FLAG_KEY = "sdl_reviews_enabled";
const REVIEWS_KEY = "sdl_reviews_v1";
const HOME_REVIEWS_KEY = "sdl_home_reviews_v1";

/* Master on/off switch.
   Client feedback #8: testimonials were missing and the "Reviews" link appeared
   broken — because this defaulted to HIDDEN. Now the reviews/testimonials section
   is shown by default so the nav link works and social proof is visible. It can
   still be toggled off from Admin → Settings → Storefront. */
let REVIEWS_ENABLED = (function(){
  try{ const v=localStorage.getItem(REVIEWS_FLAG_KEY); return v===null ? true : v==="true"; }
  catch(e){ return true; }
})();
function setReviewsEnabled(on){
  REVIEWS_ENABLED = !!on;
  try{ localStorage.setItem(REVIEWS_FLAG_KEY, REVIEWS_ENABLED?"true":"false"); }catch(e){}
  // Reviews live on the HOME page only (data-page="home"). Only reveal the section when
  // the flag is on AND we're actually on home — otherwise it leaked onto account/shop/about.
  const onHome = (typeof _sitePage==='undefined' || _sitePage==='home');
  const sec=document.getElementById('reviews'); if(sec) sec.style.display = (REVIEWS_ENABLED && onHome) ? '' : 'none';
}
/* Admin Settings toggle — flips the flag and updates the switch UI live. */
function adminToggleReviews(el){
  setReviewsEnabled(!REVIEWS_ENABLED);
  if(el) el.classList.toggle('on', REVIEWS_ENABLED);
  if(typeof toast==='function') toast(REVIEWS_ENABLED?'Reviews section is now visible':'Reviews section hidden');
}

/* Per-product reviews — seeded, then merged with anything persisted. */
const REVIEWS_SEED = {
  1:[{n:"Ananya R.",r:5,t:"Smells exactly like my grandmother's kitchen. The real bilona method.",v:true},
     {n:"Karthik M.",r:5,t:"Granular texture, beautiful aroma. Worth every rupee.",v:true}],
  3:[{n:"Meera K.",r:5,t:"Crystallised naturally in winter — that's how you know it's raw.",v:true}],
  11:[{n:"Sneha P.",r:5,t:"Deep colour and you can smell the curcumin. Excellent.",v:true}]
};
let REVIEWS = (function(){
  try{ const saved=JSON.parse(localStorage.getItem(REVIEWS_KEY)); return saved && typeof saved==='object' ? saved : JSON.parse(JSON.stringify(REVIEWS_SEED)); }
  catch(e){ return JSON.parse(JSON.stringify(REVIEWS_SEED)); }
})();
function saveReviews(){ try{ localStorage.setItem(REVIEWS_KEY, JSON.stringify(REVIEWS)); }catch(e){} }

/* Homepage general reviews (not tied to a product). Seeded testimonials
   live here too so the homepage section is fully data-driven. */
const HOME_REVIEWS_SEED = [
  {t:"The ghee genuinely smells like my grandmother's kitchen. You can tell it's the real bilona method.",n:"Ananya Rao",l:"Bengaluru",r:5,v:true},
  {t:"Switched our whole kitchen to Suddhalaya oils. The lab reports gave me the confidence no other brand did.",n:"Vikram Shetty",l:"Pune",r:5,v:true},
  {t:"Raw honey that actually crystallises naturally — that's how you know it's unprocessed. Beautiful.",n:"Meera Krishnan",l:"Chennai",r:5,v:true},
];
let HOME_REVIEWS = (function(){
  try{ const saved=JSON.parse(localStorage.getItem(HOME_REVIEWS_KEY)); return Array.isArray(saved)? saved : JSON.parse(JSON.stringify(HOME_REVIEWS_SEED)); }
  catch(e){ return JSON.parse(JSON.stringify(HOME_REVIEWS_SEED)); }
})();
function saveHomeReviews(){ try{ localStorage.setItem(HOME_REVIEWS_KEY, JSON.stringify(HOME_REVIEWS)); }catch(e){} }

const CATS = [
  {name:"A2 Dairy", sub:"Bilona Ghee", c1:"#1f3520", c2:"#2d4a2e", cats:["A2 Dairy"]},
  {name:"Cold-Pressed Oils", sub:"Wood-Pressed", c1:"#3a4718", c2:"#56682a", cats:["Cold-Pressed Oils"]},
  {name:"Honey", sub:"Raw & Wild", c1:"#6b4a1e", c2:"#8a6428", cats:["Honey"]},
  {name:"Staples & Spices", sub:"Stone-Ground", c1:"#7a3f3a", c2:"#9a5450", cats:["Staples","Spices"]},
];

/* ---------- ORDERS (full data model — audit P0 #2 / §7.5)
   Each order now carries line items (sku, variant, qty, unit price, tax),
   billing/shipping address, payment intent + status, fulfilment + tracking,
   tax breakup, and an event timeline (actor + timestamp + note). A thin
   {items,total,status} shape is no longer used anywhere. */
let ORDERS = [
  {id:"#SDL2041", customerId:1, customer:"Ananya R.", email:"ananya.r@email.com", phone:"9845012345",
   lines:[{sku:"SDL-GHEE-500",name:"A2 Desi Cow Ghee",variant:"500 ml",qty:1,price:899,gst:5},
          {sku:"SDL-HONEY-250",name:"Raw Forest Honey",variant:"250 g",qty:1,price:329,gst:5},
          {sku:"SDL-SPICE-TUR-250",name:"Organic Turmeric Powder",variant:"250 g",qty:2,price:449,gst:5}],
   ship:{name:"Ananya Rao",line:"14, 3rd Cross, Indiranagar",city:"Bengaluru",state:"Karnataka",pin:"560038"},
   payment:{method:"upi",status:"paid",txnId:"pay_NkX2041AbcD",gateway:"Razorpay",capturedAt:"22 Jun 2026 09:14"},
   shipTotal:0, status:"processing", date:"22 Jun 2026",
   timeline:[{t:"22 Jun 2026 09:12",actor:"customer",note:"Order placed"},{t:"22 Jun 2026 09:14",actor:"system",note:"Payment captured (Razorpay)"},{t:"22 Jun 2026 09:14",actor:"system",note:"GST invoice INV-2026-0041 generated"}]},
  {id:"#SDL2040", customerId:2, customer:"Vikram S.", email:"vikram.s@email.com", phone:"9812345678",
   lines:[{sku:"SDL-GHEE-500",name:"A2 Desi Cow Ghee",variant:"500 ml",qty:1,price:899,gst:5}],
   ship:{name:"Vikram Singh",line:"402, Palm Meadows, Whitefield",city:"Bengaluru",state:"Karnataka",pin:"560066"},
   payment:{method:"card",status:"paid",txnId:"pay_NkX2040EfgH",gateway:"Razorpay",capturedAt:"21 Jun 2026 18:40"},
   shipTotal:0, status:"shipped", date:"21 Jun 2026",
   tracking:{carrier:"Delhivery",awb:"DL2840117755",url:"https://www.delhivery.com/track"},
   timeline:[{t:"21 Jun 2026 18:38",actor:"customer",note:"Order placed"},{t:"21 Jun 2026 18:40",actor:"system",note:"Payment captured (Razorpay)"},{t:"21 Jun 2026 18:41",actor:"system",note:"GST invoice INV-2026-0040 generated"},{t:"22 Jun 2026 08:05",actor:"admin",note:"Packed & AWB DL2840117755 booked (Delhivery)"}]},
  {id:"#SDL2039", customerId:3, customer:"Meera K.", email:"meera.k@email.com", phone:"9900123456",
   lines:[{sku:"SDL-ATTA-5KG",name:"Stone-Ground Whole Wheat Atta",variant:"5 kg",qty:2,price:299,gst:5},
          {sku:"SDL-SALT-1KG",name:"Himalayan Pink Rock Salt",variant:"1 kg",qty:1,price:189,gst:0},
          {sku:"SDL-JAG-500",name:"Organic Jaggery Powder",variant:"500 g",qty:1,price:159,gst:5},
          {sku:"SDL-OIL-MUST-1L",name:"Cold-Pressed Mustard Oil",variant:"1 L",qty:1,price:640,gst:5}],
   ship:{name:"Meera Krishnan",line:"7, Lake View Road, Adyar",city:"Chennai",state:"Tamil Nadu",pin:"600020"},
   payment:{method:"upi",status:"paid",txnId:"pay_NkX2039IjkL",gateway:"Razorpay",capturedAt:"20 Jun 2026 11:02"},
   shipTotal:0, status:"delivered", date:"20 Jun 2026",
   tracking:{carrier:"Delhivery",awb:"DL2840116401",url:"https://www.delhivery.com/track"},
   timeline:[{t:"20 Jun 2026 11:00",actor:"customer",note:"Order placed"},{t:"20 Jun 2026 11:02",actor:"system",note:"Payment captured (Razorpay)"},{t:"20 Jun 2026 14:30",actor:"admin",note:"Shipped via Delhivery"},{t:"22 Jun 2026 10:15",actor:"system",note:"Delivered — POD captured"}]},
  {id:"#SDL2038", customerId:4, customer:"Rahul T.", email:"rahul.t@email.com", phone:"9765432109",
   lines:[{sku:"SDL-OIL-COCO-500",name:"Cold-Pressed Coconut Oil",variant:"500 ml",qty:1,price:399,gst:5},
          {sku:"SDL-SPICE-TUR-100",name:"Organic Turmeric Powder",variant:"100 g",qty:1,price:199,gst:5}],
   ship:{name:"Rahul Thakur",line:"22, Sector 18, Noida",city:"Noida",state:"Uttar Pradesh",pin:"201301"},
   payment:{method:"cod",status:"pending",txnId:"",gateway:"COD",capturedAt:""},
   shipTotal:60, status:"delivered", date:"20 Jun 2026",
   tracking:{carrier:"Delhivery",awb:"DL2840115988",url:"https://www.delhivery.com/track"},
   timeline:[{t:"20 Jun 2026 09:20",actor:"customer",note:"Order placed (COD)"},{t:"20 Jun 2026 15:00",actor:"admin",note:"Shipped via Delhivery"},{t:"22 Jun 2026 12:40",actor:"system",note:"Delivered — COD ₹658 collected"}]},
  {id:"#SDL2037", customerId:5, customer:"Pooja N.", email:"pooja.n@email.com", phone:"9871203456",
   lines:[{sku:"SDL-GHEE-BUF-500",name:"A2 Buffalo Ghee",variant:"500 ml",qty:1,price:799,gst:5},
          {sku:"SDL-HONEY-CIN-250",name:"Wild Honey & Cinnamon Spread",variant:"250 g",qty:1,price:449,gst:5},
          {sku:"SDL-OIL-SES-500",name:"Cold-Pressed Sesame Oil",variant:"500 ml",qty:2,price:355,gst:5}],
   ship:{name:"Pooja Nair",line:"9, MG Road, Kochi",city:"Kochi",state:"Kerala",pin:"682016"},
   payment:{method:"upi",status:"paid",txnId:"pay_NkX2037MnoP",gateway:"Razorpay",capturedAt:"19 Jun 2026 20:11"},
   shipTotal:0, status:"processing", date:"19 Jun 2026",
   timeline:[{t:"19 Jun 2026 20:09",actor:"customer",note:"Order placed"},{t:"19 Jun 2026 20:11",actor:"system",note:"Payment captured (Razorpay)"},{t:"19 Jun 2026 20:11",actor:"system",note:"GST invoice INV-2026-0037 generated"}]},
];
/* derive items count + total from line items so the two can never disagree (audit §11) */
function orderItemsCount(o){return (o.lines||[]).reduce((s,l)=>s+l.qty,0);}
function orderSubtotal(o){return round2((o.lines||[]).reduce((s,l)=>s+l.price*l.qty,0));}
function orderTaxBreakup(o){
  // GST is inclusive in displayed price (audit: storefront shows 'incl. GST').
  const map={};
  (o.lines||[]).forEach(l=>{const gross=l.price*l.qty;const rate=l.gst||0;const tax=gross-(gross/(1+rate/100));map[rate]=round2((map[rate]||0)+tax);});
  return map;
}
function orderTaxTotal(o){return round2(Object.values(orderTaxBreakup(o)).reduce((s,v)=>s+v,0));}
function orderTotal(o){return round2(orderSubtotal(o)+(o.shipTotal||0));}
ORDERS.forEach(o=>{o.items=orderItemsCount(o);o.total=orderTotal(o);});

/* ---------- cart persistence (localStorage) — fixes "cart resets on refresh" ---------- */
const CART_KEY="sdl_cart_v2", WISH_KEY="sdl_wish_v2", CONSENT_KEY="sdl_cookie_consent";
function loadCart(){try{return JSON.parse(localStorage.getItem(CART_KEY))||[];}catch(e){return [];}}
function saveCart(){try{localStorage.setItem(CART_KEY,JSON.stringify(CART));}catch(e){}}
/* Wishlist is login-gated + per-user (client request): stored per signed-in email,
   empty for guests, and the UI only appears when a shopper is signed in. */
function wishStoreKey(){ const u=currentShopper(); return (u&&u.email)?WISH_KEY+'_'+u.email.toLowerCase():null; }
function loadWish(){ const k=wishStoreKey(); if(!k) return new Set(); try{return new Set(JSON.parse(localStorage.getItem(k))||[]);}catch(e){return new Set();} }
function saveWish(){ const k=wishStoreKey(); if(!k) return; try{localStorage.setItem(k,JSON.stringify([...WISH]));}catch(e){} }
/* Reload the wishlist for the current auth state and sync the header icon + cards. */
function refreshWishlist(){
  WISH = loadWish();
  const signedIn = !!currentShopper();
  const btn=document.getElementById('wishBtn'); if(btn) btn.style.display = signedIn ? '' : 'none';
  const c=document.getElementById('wishCount'); if(c){ c.textContent=WISH.size; c.style.display=(signedIn && WISH.size)?'flex':'none'; }
  if(typeof renderProducts==='function') renderProducts();   // show/hide the heart on cards
}

/* ---------- Customer accounts (client-side; backend swap-points marked) ---------- */
/* NOTE FOR PRODUCTION: accounts here live in this browser's localStorage so a
   shopper can register and sign back in on THIS device. A real store must move
   this to a server: the registry below becomes a users table, hashPwd() becomes
   bcrypt/argon2 on the server, and SESSION becomes an httpOnly session/JWT cookie.
   The function names (registerUser/loginUser/logoutUser/currentShopper) are the exact
   hooks a backend would replace. UI does not change when you swap them. */
const USERS_KEY="sdl_users_v1", SESSION_KEY="sdl_session_v1";
/* lightweight non-cryptographic hash — ONLY so plaintext passwords are never
   stored in the browser. Real auth must hash+salt server-side. */
function hashPwd(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}return("00000000"+(h>>>0).toString(16)).slice(-8);}
function loadUsers(){try{return JSON.parse(localStorage.getItem(USERS_KEY))||{};}catch(e){return {};}}
function saveUsers(u){try{localStorage.setItem(USERS_KEY,JSON.stringify(u));}catch(e){}}
function currentShopper(){
  if(BACKEND) return CURRENT_USER ? {...CURRENT_USER} : null;
  try{const e=localStorage.getItem(SESSION_KEY);if(!e)return null;const u=loadUsers()[e.toLowerCase()];return u?{...u}:null;}catch(e){return null;}
}
function setSession(email){try{email?localStorage.setItem(SESSION_KEY,email.toLowerCase()):localStorage.removeItem(SESSION_KEY);}catch(e){}}
/* Normalise an Indian mobile number to its 10 digits (or "" if invalid). */
function normPhone(s){const d=(s||"").replace(/\D/g,"").slice(-10);return /^[6-9]\d{9}$/.test(d)?d:"";}
function registerUser(name,email,phone,pwd){
  email=(email||"").trim().toLowerCase();
  phone=normPhone(phone);
  if(!name||!name.trim()) return {ok:false,err:"Please enter your name."};
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return {ok:false,err:"Enter a valid email address."};
  if(!phone) return {ok:false,err:"Enter a valid 10-digit mobile number."};
  if(!pwd||pwd.length<6) return {ok:false,err:"Password must be at least 6 characters."};
  const users=loadUsers();
  if(users[email]) return {ok:false,err:"An account with this email already exists. Try signing in."};
  if(Object.values(users).some(u=>u.phone&&u.phone===phone)) return {ok:false,err:"An account with this mobile number already exists."};
  users[email]={name:name.trim(),email,phone,pass:hashPwd(pwd),addresses:[],joined:nowStamp()};
  saveUsers(users); setSession(email);
  return {ok:true,user:{...users[email]}};
}
/* Sign in with either an email address or a registered mobile number. */
function loginUser(identifier,pwd){
  const id=(identifier||"").trim();
  const users=loadUsers();
  let u=users[id.toLowerCase()];
  if(!u){const ph=normPhone(id);if(ph)u=Object.values(users).find(x=>x.phone===ph);}
  if(!u) return {ok:false,err:"No account found for that email or mobile number."};
  if(u.pass!==hashPwd(pwd||"")) return {ok:false,err:"Incorrect password."};
  setSession(u.email); return {ok:true,user:{...u}};
}
function logoutUser(){setSession(null);}
function userOrders(email){ // orders linked to this account
  if(BACKEND) return MY_ORDERS||[];
  if(!email) return [];
  return ORDERS.filter(o=>(o.email||"").toLowerCase()===email.toLowerCase());
}
/* ---- Shopper order details + invoice (client: "can't see order details / no invoice") ---- */
function findMyOrder(id){ return (userOrders(currentShopper()&&currentShopper().email)||[]).find(o=>String(o.id)===String(id)); }
function rupees(n){ return '₹'+(Number(n)||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function openMyOrder(id){
  const o=findMyOrder(id); if(!o){ toast('Order not found'); return; }
  const lines=o.lines||[]; const ship=o.ship||{}; const pay=o.payment||{}; const tl=o.timeline||[];
  const itemsHTML = lines.length ? lines.map(l=>`<tr>
      <td>${escapeHtml(l.name||l.sku||'')}${l.variant?`<span class="od-var"> · ${escapeHtml(l.variant)}</span>`:''}</td>
      <td class="num">${l.qty}</td><td class="num">${rupees(l.price)}</td>
      <td class="num">${rupees((Number(l.price)||0)*(l.qty||1))}</td></tr>`).join('')
    : `<tr><td colspan="4" class="muted">Item breakdown not available for this order.</td></tr>`;
  $("#modalRoot").innerHTML=`<div class="modal-bg" onclick="closeModal()"></div>
   <div class="modal-card wide" role="dialog" aria-modal="true" aria-label="Order ${escapeHtml(o.id)}">
     <div class="modal-head"><h3>Order ${escapeHtml(o.id)}</h3><button class="x" aria-label="Close" onclick="closeModal()">×</button></div>
     <div class="modal-body">
       <div class="od-top">
         <div><span class="od-label">Placed</span> ${escapeHtml(o.date||'—')}</div>
         <div><span class="od-label">Status</span> <span class="badge ${o.status}">${o.status}</span></div>
         <div><span class="od-label">Payment</span> ${escapeHtml((pay.method||'').toUpperCase()||'—')} · ${pay.status==='paid'?'Paid':'Pending'}</div>
         ${o.tracking?`<div><span class="od-label">Tracking</span> ${escapeHtml(o.tracking)}</div>`:''}
       </div>
       <table class="od-items"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>${itemsHTML}</tbody></table>
       <div class="od-totals">
         <div><span>Subtotal</span><span>${rupees(o.subtotal||0)}</span></div>
         <div><span>Shipping</span><span>${(o.shipTotal||0)>0?rupees(o.shipTotal):'Free'}</span></div>
         <div class="od-grand"><span>Total</span><span>${rupees(o.total||0)}</span></div>
         <div class="od-tax">Inclusive of GST ${rupees(o.taxTotal||0)}</div>
       </div>
       <div class="od-cols">
         <div><h5>Delivery address</h5><p>${escapeHtml(ship.name||o.customer||'')}<br>${escapeHtml(ship.line||'')}<br>${escapeHtml([ship.city,ship.state,ship.pin].filter(Boolean).join(', '))}${o.phone?`<br>☎ ${escapeHtml(o.phone)}`:''}</p></div>
         ${tl.length?`<div><h5>Timeline</h5><ul class="od-timeline">${tl.map(e=>`<li><b>${escapeHtml(e.t||'')}</b> ${escapeHtml(e.note||'')}</li>`).join('')}</ul></div>`:''}
       </div>
       ${o.tracking?`<div class="od-track">
         <div class="od-track-head"><h5 style="margin:0">Shipment tracking</h5><span class="od-track-awb">AWB <b>${escapeHtml(o.tracking)}</b> · Ekart</span></div>
         <div id="odTrackBody"><button class="btn btn-primary" style="margin-top:.6rem" onclick="trackMyShipment('${escapeHtml(o.tracking)}')">📦 Track shipment</button></div>
       </div>`:''}
       <div class="od-actions">
         <button class="btn btn-primary" onclick="downloadOrderInvoice('${escapeHtml(o.id)}')">⭳ Download invoice</button>
       </div>
     </div>
   </div>`;
  $("#modalRoot").classList.add('show');
}
/* Live Ekart shipment tracking, shown inside the order-detail modal. Falls back to
   the public "Track on Ekart" link when the live API isn't configured yet. */
async function trackMyShipment(awb){
  const box=$("#odTrackBody"); if(!box) return;
  box.innerHTML='<div class="od-track-loading">Fetching latest status from Ekart…</div>';
  const r=await SDB.trackShipment(awb);
  if(!r || r.ok===false){
    const link=r&&r.trackingUrl;
    box.innerHTML=`<p class="od-track-err">${escapeHtml((r&&r.err)||'Could not fetch tracking right now.')}</p>${link?`<a class="btn btn-ghost" href="${escapeHtml(link)}" target="_blank" rel="noopener">Track on Ekart ↗</a>`:''}`;
    return;
  }
  const ekartLink=r.trackingUrl?`<a class="btn btn-ghost" href="${escapeHtml(r.trackingUrl)}" target="_blank" rel="noopener">Open on Ekart ↗</a>`:'';
  if(r.apiConfigured===false){
    // API keys not fully set up yet → offer the public tracking page.
    box.innerHTML=`<p class="od-track-note">Track your parcel on Ekart with AWB <b>${escapeHtml(awb)}</b>.</p>${ekartLink||''}`;
    return;
  }
  const cps=Array.isArray(r.checkpoints)?r.checkpoints:[];
  box.innerHTML=`
    ${r.status?`<div class="od-track-status">Status: <b>${escapeHtml(r.status)}</b></div>`:''}
    ${cps.length?`<ul class="od-track-list">${cps.map(c=>`<li><span class="od-track-dot"></span><div><b>${escapeHtml(c.status||'')}</b>${c.location?` · ${escapeHtml(c.location)}`:''}<br><small>${escapeHtml(c.time||'')}</small></div></li>`).join('')}</ul>`:'<p class="od-track-note">No scan updates yet — check back soon.</p>'}
    ${ekartLink}`;
}
/* A self-contained, print-ready invoice document (user can Save as PDF from the print dialog). */
function invoiceDoc(o){
  const c=(typeof storeContact==='function')?storeContact():{};
  const pay=o.payment||{}; const ship=o.ship||{}; const lines=o.lines||[];
  const paid=pay.status==='paid';
  const invNo=pay.invoice||('ORD-'+o.id);
  const gstin=(SETTINGS&&SETTINGS.gstin)||'';
  const logo=(typeof brandLogo==='function')?brandLogo():'';
  const rows=lines.map((l,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(l.name||l.sku||'')}${l.variant?' · '+escapeHtml(l.variant):''}${l.gst?`<div class="hsn">GST ${l.gst}%</div>`:''}</td><td class="r">${l.qty}</td><td class="r">${rupees(l.price)}</td><td class="r">${rupees((Number(l.price)||0)*(l.qty||1))}</td></tr>`).join('')
    || `<tr><td colspan="5">Item breakdown not available.</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${paid?'Tax Invoice':'Invoice'} ${escapeHtml(invNo)}</title>
  <style>
    *{box-sizing:border-box} body{font-family:Segoe UI,Arial,sans-serif;color:#2c2c28;margin:0;padding:32px;background:#fff}
    .inv{max-width:760px;margin:0 auto} .top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:2px solid #1f3520;padding-bottom:16px}
    .brand{display:flex;gap:12px;align-items:center} .brand img{height:56px;width:auto} .co h1{font-size:18px;color:#1f3520;margin:0 0 3px} .co p{margin:1px 0;font-size:12px;color:#6b665c}
    .meta{text-align:right} .meta h2{margin:0 0 6px;font-size:20px;letter-spacing:1px;color:#1f3520;text-transform:uppercase} .meta p{margin:2px 0;font-size:12.5px}
    .parties{display:flex;justify-content:space-between;gap:20px;margin:22px 0} .parties h3{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#b08d3c;margin:0 0 5px} .parties p{margin:0;font-size:13px;line-height:1.5}
    table{width:100%;border-collapse:collapse;margin-top:8px} th{background:#1f3520;color:#faf6ee;font-size:11px;letter-spacing:.5px;text-transform:uppercase;padding:8px 10px;text-align:left} td{padding:8px 10px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top} .r{text-align:right} .hsn{font-size:10.5px;color:#9a9488}
    .totals{margin-top:14px;margin-left:auto;width:280px;font-size:13px} .totals div{display:flex;justify-content:space-between;padding:4px 0} .totals .grand{border-top:1.5px solid #1f3520;margin-top:6px;padding-top:8px;font-weight:700;color:#1f3520;font-size:15px} .tax{font-size:11.5px;color:#9a9488;text-align:right;margin-top:4px}
    .pay{margin-top:18px;font-size:12.5px} .pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600} .pill.ok{background:#e6f0e6;color:#1f6b2f} .pill.no{background:#f6e9d8;color:#8a5a12}
    .foot{margin-top:26px;padding-top:14px;border-top:1px solid #eee;font-size:11px;color:#9a9488;text-align:center}
    @media print{body{padding:0}.inv{max-width:none}}
  </style></head><body><div class="inv">
    <div class="top">
      <div class="brand">${logo?`<img src="${logo}" alt="">`:''}<div class="co"><h1>Suddhalaya Organic Pvt Ltd</h1><p>${escapeHtml(c.address||'')}</p><p>${escapeHtml(c.email||'')} · ${escapeHtml(c.phone||'')}</p>${gstin?`<p>GSTIN: ${escapeHtml(gstin)}</p>`:''}</div></div>
      <div class="meta"><h2>${paid?'Tax Invoice':'Invoice'}</h2><p><b>No:</b> ${escapeHtml(invNo)}</p><p><b>Order:</b> ${escapeHtml(o.id)}</p><p><b>Date:</b> ${escapeHtml(o.date||'')}</p></div>
    </div>
    <div class="parties">
      <div><h3>Billed to</h3><p><b>${escapeHtml(ship.name||o.customer||'')}</b><br>${escapeHtml(ship.line||'')}<br>${escapeHtml([ship.city,ship.state,ship.pin].filter(Boolean).join(', '))}${o.phone?'<br>☎ '+escapeHtml(o.phone):''}${o.email?'<br>'+escapeHtml(o.email):''}</p></div>
      <div style="text-align:right"><h3>Status</h3><p>${escapeHtml(o.status||'')}</p></div>
    </div>
    <table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals">
      <div><span>Subtotal</span><span>${rupees(o.subtotal||0)}</span></div>
      <div><span>Shipping</span><span>${(o.shipTotal||0)>0?rupees(o.shipTotal):'Free'}</span></div>
      <div class="grand"><span>Total</span><span>${rupees(o.total||0)}</span></div>
      <div class="tax">Inclusive of GST ${rupees(o.taxTotal||0)}</div>
    </div>
    <div class="pay"><b>Payment:</b> ${escapeHtml((pay.method||'').toUpperCase()||'—')} · <span class="pill ${paid?'ok':'no'}">${paid?'Paid':'Payment pending'}</span>${pay.txnId?` &nbsp; <span style="color:#9a9488">Txn: ${escapeHtml(pay.txnId)}</span>`:''}</div>
    <div class="foot">Prices are inclusive of GST. This is a computer-generated ${paid?'invoice':'document'} and does not require a signature.<br>Thank you for shopping with Suddhalaya · ${escapeHtml(c.email||'')}</div>
  </div></body></html>`;
}
function downloadOrderInvoice(id){
  const o=findMyOrder(id); if(!o){ toast('Order not found'); return; }
  const w=window.open('','_blank');
  if(!w){ toast('Please allow pop-ups to download the invoice'); return; }
  w.document.open(); w.document.write(invoiceDoc(o)); w.document.close();
  setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} }, 400);
}
function saveUserAddress(email,addr){
  const users=loadUsers(); const u=users[(email||"").toLowerCase()];
  if(!u) return; u.addresses=u.addresses||[];
  if(!u.addresses.some(a=>JSON.stringify(a)===JSON.stringify(addr))) u.addresses.unshift(addr);
  saveUsers(users);
}
/* Client QA r2: address book keyed by email, works in BOTH backend and offline modes.
   Sources: this device's saved book, the offline users store, and the shopper's own
   order history (server-backed in backend mode). "Address saved under profile" + reuse. */
const ADDR_BOOK_KEY='sdl_addr_book_v1';
function loadAddrBook(){try{return JSON.parse(localStorage.getItem(ADDR_BOOK_KEY)||'{}');}catch(e){return {};}}
function saveAddrBook(b){try{localStorage.setItem(ADDR_BOOK_KEY,JSON.stringify(b));}catch(e){}}
function addrKey(a){return [(a.addr||a.line||''),(a.city||''),(a.state||''),(a.pin||'')].join('|').toLowerCase().replace(/\s+/g,' ').trim();}
function rememberAddress(email,addr){
  if(!email||!addr)return; email=email.toLowerCase();
  const line=addr.addr||addr.line||''; if(!line)return;
  const norm={name:addr.name||'',addr:line,city:addr.city||'',state:addr.state||'',pin:addr.pin||'',phone:addr.phone||''};
  const book=loadAddrBook(); const k=addrKey(norm);
  book[email]=[norm,...((book[email]||[]).filter(a=>addrKey(a)!==k))].slice(0,10);
  saveAddrBook(book);
  saveUserAddress(email,norm); // keep offline users store in sync when present
}
function savedAddresses(email){
  if(!email)return []; email=email.toLowerCase();
  const out=[],seen=new Set();
  const push=a=>{if(!a)return;const line=a.addr||a.line||'';if(!line)return;
    const norm={name:a.name||'',addr:line,city:a.city||'',state:a.state||'',pin:a.pin||'',phone:a.phone||''};
    const k=addrKey(norm);if(seen.has(k))return;seen.add(k);out.push(norm);};
  (loadAddrBook()[email]||[]).forEach(push);
  const u=(loadUsers()||{})[email]; if(u&&u.addresses)u.addresses.forEach(push);
  const hist=BACKEND?(MY_ORDERS||[]):ORDERS.filter(o=>(o.email||'').toLowerCase()===email);
  hist.slice(0,20).forEach(o=>{if(o.ship)push({name:o.ship.name,addr:o.ship.line,city:o.ship.city,state:o.ship.state,pin:o.ship.pin,phone:o.phone});});
  return out.slice(0,10);
}
/* Client request: manage multiple addresses from the account page. The managed set
   is the per-user address book (add / remove); checkout still merges in order history. */
function accountAddresses(email){
  if(!email) return [];
  return (loadAddrBook()[email.toLowerCase()]||[]).map(a=>({name:a.name||'',addr:a.addr||a.line||'',city:a.city||'',state:a.state||'',pin:a.pin||'',phone:a.phone||''}));
}
function removeAddress(email,key){
  if(!email)return; email=email.toLowerCase();
  const book=loadAddrBook();
  if(book[email]){ book[email]=book[email].filter(a=>addrKey(a)!==key); saveAddrBook(book); }
  try{ const users=loadUsers(); const uu=users[email]; if(uu&&uu.addresses){ uu.addresses=uu.addresses.filter(a=>addrKey(a)!==key); saveUsers(users); } }catch(e){}
}
let _acctAddrs=[];
let _editAddrIdx=-1;   // -1 = adding a new address; >=0 = editing that saved address
function toggleAaForm(show){
  const f=$("#aaForm"); if(!f) return;
  const open=(show===undefined)?(f.style.display==='none'):show;
  f.style.display=open?'':'none';
  const t=$("#aaAddBtn"); if(t)t.textContent=open?'✕ Cancel':'＋ Add address';
  if(!open) _editAddrIdx=-1;   // closing / cancelling clears any edit
  if(open) setTimeout(()=>$("#aaName")?.focus(),30);
}
function clearAddrForm(){ ['aaName','aaPhone','aaAddr','aaPin','aaCity','aaState'].forEach(id=>{const el=$("#"+id);if(el)el.value='';}); document.querySelectorAll('#aaForm .aa-invalid').forEach(e=>e.classList.remove('aa-invalid')); const m=$("#aaPinMsg"); if(m){m.className='pin-msg';m.textContent='';} }
/* "+ Add address" — always opens a fresh, blank form (not an edit). */
function startAddAddress(){
  const f=$("#aaForm"); const opening = f && f.style.display==='none';
  if(opening){ _editAddrIdx=-1; clearAddrForm(); const b=$("#aaSaveBtn"); if(b)b.textContent='Save address'; }
  toggleAaForm();
}
/* Edit an existing saved address: prefill the form and switch it to update mode. */
function editAccountAddress(i){
  const a=_acctAddrs[i]; if(!a) return;
  _editAddrIdx=i;
  toggleAaForm(true);
  clearAddrForm();
  const set=(id,v)=>{const el=$("#"+id); if(el) el.value=v||'';};
  set('aaName',a.name); set('aaPhone',a.phone); set('aaAddr',a.addr); set('aaPin',a.pin); set('aaCity',a.city); set('aaState',a.state);
  const b=$("#aaSaveBtn"); if(b)b.textContent='Update address';
}
/* Inline field validation for the saved-address form — mirrors validateCheckout()
   (required fields + a real 10-digit Indian mobile), shown per-field like checkout. */
function validateAccountAddress(){
  let ok=true;
  const set=(id,valid)=>{const el=document.getElementById(id); if(!el)return; const wrap=el.parentElement;
    if(valid) wrap.classList.remove('aa-invalid'); else { wrap.classList.add('aa-invalid'); ok=false; }};
  const val=id=>(document.getElementById(id)?.value||'').trim();
  set('aaName', val('aaName').length>0);
  set('aaPhone', /^[6-9]\d{9}$/.test(val('aaPhone').replace(/\D/g,'').slice(-10)));
  set('aaAddr', val('aaAddr').length>4);
  set('aaPin', /^\d{6}$/.test(val('aaPin').replace(/\D/g,'')));
  set('aaCity', val('aaCity').length>0);
  set('aaState', val('aaState').length>0);
  return ok;
}
function clearAaError(el){ if(el&&el.parentElement) el.parentElement.classList.remove('aa-invalid'); }
function saveAccountAddress(){
  const u=currentShopper(); if(!u){ toast('Please sign in'); return; }
  if(!validateAccountAddress()){ toast('Please fix the highlighted fields'); return; }
  const g=id=>($("#"+id)?.value||'').trim();
  const addr={ name:g('aaName'), addr:g('aaAddr'), city:g('aaCity'), state:g('aaState'), pin:g('aaPin').replace(/\D/g,''), phone:g('aaPhone').replace(/\D/g,'').slice(-10) };
  const editing = _editAddrIdx>=0;
  if(editing){ const old=_acctAddrs[_editAddrIdx]; if(old) removeAddress(u.email, addrKey(old)); }  // replace the original
  rememberAddress(u.email, addr);
  _editAddrIdx=-1;
  rerenderAccount();
  toast(editing?'Address updated':'Address saved');
}
function removeAccountAddress(i){
  const u=currentShopper(); if(!u) return;
  const a=_acctAddrs[i]; if(!a) return;
  if(!confirm('Remove this address?')) return;
  removeAddress(u.email, addrKey(a));
  rerenderAccount();
  toast('Address removed');
}
/* pincode auto-detect for the account address form */
async function onAaPin(){
  const el=$("#aaPin"); if(!el) return;
  const pin=(el.value||'').replace(/\D/g,'').slice(0,6); el.value=pin;
  const msg=$("#aaPinMsg");
  if(pin.length!==6){ if(msg){msg.className='pin-msg';msg.textContent='';} return; }
  if(msg){msg.className='pin-msg loading';msg.textContent='Detecting city & state…';}
  try{
    const r=await fetch('https://api.postalpincode.in/pincode/'+pin,{cache:'force-cache'});
    const j=await r.json(); const rec=Array.isArray(j)?j[0]:null;
    if(rec&&rec.Status==='Success'&&rec.PostOffice&&rec.PostOffice.length){
      const po=rec.PostOffice[0]; const city=po.District||po.Division||po.Block||''; const state=po.State||'';
      const c=$("#aaCity"),s=$("#aaState"); if(c&&city)c.value=city; if(s&&state)s.value=state;
      if(msg){msg.className='pin-msg ok';msg.textContent='✓ '+city+', '+state;}
    } else if(msg){msg.className='pin-msg no';msg.textContent='PIN not recognised — type city & state manually.';}
  }catch(e){ if(msg){msg.className='pin-msg no';msg.textContent='Offline — type city & state manually.';} }
}

let CART = loadCart();           // items: {id, vsku, qty}
let WISH = loadWish();
let activeFilter = "All";
let activeFilterCats = null;
let activeTag = null; // null | 'best' — Best Sellers shop view (New Arrivals removed per client feedback)
let activeSort = "featured";
let payMethod = "online";   // Razorpay handles the actual method (UPI/Card/Netbanking/Wallet); 'cod' = Cash on Delivery
let appliedCoupon = null;        // {code, type:'pct'|'flat', value}

/* =====================================================================
   ADMIN DATA LAYER + PERSISTENCE  (audit P0 #1 / §7.17 / §9 "Data durability")
   ---------------------------------------------------------------------
   Every operational entity below is now persisted to localStorage so that
   NOTHING the admin does is lost on refresh. In production this same data
   model maps 1:1 to PostgreSQL tables behind a server API — the audit's
   recommended architecture — but within a single-file prototype localStorage
   is the honest, working stand-in for "a durable single source of truth".
   The DB() helper wraps load/save per collection with safe fallbacks. */
const DB_PREFIX = "sdl_admin_v1__";
function dbLoad(key, fallback){
  try{ const raw=localStorage.getItem(DB_PREFIX+key); return raw?JSON.parse(raw):fallback; }
  catch(e){ return fallback; }
}
function dbSave(key, value){
  try{ localStorage.setItem(DB_PREFIX+key, JSON.stringify(value)); return true; }
  catch(e){ console.warn("Persist failed for",key,e); return false; }
}
/* Persist the core collections after any mutation. Called by every admin write. */
function persistAll(){
  dbSave("products", PRODUCTS);
  dbSave("orders", ORDERS);
  dbSave("customers", CUSTOMERS);
  dbSave("categories", CATEGORIES);
  dbSave("coupons", COUPONS);
  dbSave("returns", RETURNS);
  dbSave("audit", AUDIT);
  dbSave("settings", SETTINGS);
  dbSave("cms", CMS);
  dbSave("invoiceSeq", INVOICE_SEQ);
}
function persist(key, value){ /* targeted single-collection save */
  if(value!==undefined) dbSave(key, value);
  else persistAll();
}

/* coupon catalogue — now an admin-managed, persisted collection (audit P1 #7 / §7.9) */
let COUPONS = dbLoad("coupons", {
  "PURE10":{type:"pct",value:10,desc:"10% off",active:true,uses:42,cap:0,expires:"31 Dec 2026",minCart:0},
  "FIRST100":{type:"flat",value:100,desc:"₹100 off first order",active:true,uses:128,cap:0,expires:"31 Dec 2026",minCart:499},
  "GHEE15":{type:"pct",value:15,desc:"15% off ghee",active:true,uses:17,cap:200,expires:"31 Aug 2026",minCart:0}
});

/* customers (audit P1 #4 / §7.6) */
let CUSTOMERS = dbLoad("customers", [
  {id:1,name:"Ananya R.",email:"ananya.r@email.com",phone:"9845012345",city:"Bengaluru",since:"12 Jan 2026",tags:["VIP"]},
  {id:2,name:"Vikram S.",email:"vikram.s@email.com",phone:"9812345678",city:"Bengaluru",since:"03 Feb 2026",tags:[]},
  {id:3,name:"Meera K.",email:"meera.k@email.com",phone:"9900123456",city:"Chennai",since:"21 Nov 2025",tags:["Repeat"]},
  {id:4,name:"Rahul T.",email:"rahul.t@email.com",phone:"9765432109",city:"Noida",since:"18 Mar 2026",tags:[]},
  {id:5,name:"Pooja N.",email:"pooja.n@email.com",phone:"9871203456",city:"Kochi",since:"29 Apr 2026",tags:["Repeat"]}
]);

/* first-class categories (audit P1 #5 / §7.3) */
let CATEGORIES = dbLoad("categories", [
  {id:1,name:"A2 Dairy",slug:"a2-dairy",seo:"Bilona A2 ghee & dairy",order:1},
  {id:2,name:"Cold-Pressed Oils",slug:"cold-pressed-oils",seo:"Wood-pressed cooking oils",order:2},
  {id:3,name:"Honey",slug:"honey",seo:"Raw & wild honey",order:3},
  {id:4,name:"Staples",slug:"staples",seo:"Stone-ground staples",order:4},
  {id:5,name:"Spices",slug:"spices",seo:"Single-origin spices",order:5}
]);

/* returns / RMA (audit P1 #3 / §7.11) */
let RETURNS = dbLoad("returns", [
  {id:"RMA-1004",orderId:"#SDL2039",customer:"Meera K.",sku:"SDL-OIL-MUST-1L",reason:"Leaked in transit",status:"approved",refund:640,date:"21 Jun 2026",restock:false}
]);

/* ---------- Phase 4.1: warehouses + batch inventory ---------- */
let WAREHOUSES = dbLoad("warehouses", [
  {id:1,name:"Main Warehouse",code:"MAIN",city:"Bengaluru",state:"Karnataka",pincode:"560001",address:"",active:true,isDefault:true}
]);
function defaultWarehouse(){ return WAREHOUSES.find(w=>w.isDefault&&w.active) || WAREHOUSES.find(w=>w.active) || WAREHOUSES[0]; }
function warehouseName(id){ const w=WAREHOUSES.find(x=>x.id===id); return w?w.name:('WH '+id); }
/* remaining units of a variant: sum of its batches if it has any, else the plain mirror */
function variantRemaining(v){ return (v&&Array.isArray(v.batches)&&v.batches.length) ? v.batches.reduce((s,b)=>s+(+b.remaining||0),0) : (v?v.stock:0); }
/* offline FIFO deduction from a variant's batches (oldest mfg first); falls back to plain stock */
function deductVariantOffline(v, qty){
  if(!v) return;
  if(Array.isArray(v.batches) && v.batches.length){
    let need=qty;
    v.batches.slice().sort((a,b)=>String(a.mfgDate||'').localeCompare(String(b.mfgDate||''))).forEach(b=>{
      if(need<=0) return; const take=Math.min(b.remaining||0, need); b.remaining=(b.remaining||0)-take; need-=take;
    });
    v.stock = variantRemaining(v);
  } else {
    v.stock = Math.max(0, (v.stock||0) - qty);
  }
}
/* expiry status for a batch: 'expired' | 'soon' (≤30d) | '' */
function batchExpiryState(expiryDate){
  if(!expiryDate) return '';
  const today=new Date(); today.setHours(0,0,0,0);
  const exp=new Date(expiryDate+'T00:00:00'); if(isNaN(exp)) return '';
  const days=Math.round((exp-today)/86400000);
  return days<0 ? 'expired' : (days<=30 ? 'soon' : '');
}

/* immutable audit log (audit P0 #5 / §7.16) — append-only in this session, persisted */
let AUDIT = dbLoad("audit", [
  {t:"22 Jun 2026 08:05",actor:"admin",action:"order.ship",entity:"#SDL2040",detail:"Booked AWB DL2840117755 (Delhivery)"},
  {t:"21 Jun 2026 18:41",actor:"system",action:"invoice.generate",entity:"#SDL2040",detail:"INV-2026-0040"}
]);
function logAudit(action, entity, detail){
  const e={t:nowStamp(),actor:currentUser.name,action,entity:String(entity||"—"),detail:detail||""};
  AUDIT.unshift(e); persist("audit",AUDIT); return e;
}

/* store settings / configuration (audit P2 #5 / §7.17) */
let SETTINGS = dbLoad("settings", {
  storeName:"Suddhalaya",
  supportEmail:"support@suddhalaya.com",
  freeShipThreshold:999,
  flatShip:60,
  codEnabled:true,        // client #4: Cash on Delivery is now admin-toggleable
  codMaxOrder:0,          // 0 = no cap; else COD hidden when basket total exceeds this
  gstin:"29ABCDE1234F1Z5",
  invoicePrefix:"INV-2026-",
  notifyEmail:true, notifySms:false, notifyWhatsapp:false,
  integrations:[
    ["Razorpay","Payments","in"],["Delhivery","Logistics","in"],
    ["Google Analytics 4","Analytics","in"],["Meta Pixel","Marketing","low"],
    ["WhatsApp Commerce","Messaging","out"],["Email (SMTP)","Transactional","in"]
  ]
});

/* CMS content (audit P2 #4 / §7.12) */
let CMS = dbLoad("cms", {
  announcement:"Free shipping over ₹999 · 100% pure, lab-tested staples",
  heroTitle:"The House of Purity",
  returnPolicy:"7-day easy returns on unopened items.",
  // client #5: high-velocity content — hero + founder story editable from admin
  heroEyebrow:"Farm-to-Home · Certified Organic",
  heroHeadline:"Purity you can <em>taste</em>, traceability you can trust.",
  heroLead:"From bilona-churned A2 ghee to wood-pressed oils and raw forest honey — every Suddhalaya batch is lab-tested and traceable to its source.",
  storyEyebrow:"Our Story",
  storyHeading:'Born from a simple frustration with "organic" labels.',
  storyP1:"We started Suddhalaya because the word organic had lost its meaning — printed on packets with no proof behind it. We wanted food we could trace back to the soil, the cow, the hive.",
  storyP2:"So we built direct relationships with small farms, brought back slow traditional methods, and put a lab report behind every batch.",
  heroImage:"",   // data URL / URL; falls back to the built-in hero art when blank
  storyImage:"",  // data URL / URL; falls back to the built-in story art when blank
  logo:""         // client #7: one official brand logo used consistently everywhere (header, footer, login, hero seal)
});
/* Single source of truth for the brand mark so it stays identical across the site.
   Default is the official Suddhalaya lockup shipped in /public; admins can override
   it via Admin → Content → Brand logo. (client #7) */
const BRAND_LOGO_URL = "/brand-logo.png";
function brandLogo(){ return (typeof CMS!=='undefined' && CMS.logo) ? CMS.logo : BRAND_LOGO_URL; }

/* ---- Lightweight on-site analytics (client #13): traffic + engagement funnel ----
   Real events are tracked into localStorage: page views, product views, add-to-cart,
   and orders — bucketed per day. In production this is where GA4 / server events feed. */
let ANALYTICS = dbLoad("analytics", {daily:{}, totals:{view:0,product:0,cart:0,order:0}});
function _today(){try{return new Date().toISOString().slice(0,10);}catch(e){return "day";}}
function track(evt){
  try{
    if(!ANALYTICS.daily)ANALYTICS.daily={}; if(!ANALYTICS.totals)ANALYTICS.totals={};
    const d=_today();
    ANALYTICS.daily[d]=ANALYTICS.daily[d]||{view:0,product:0,cart:0,order:0};
    if(ANALYTICS.daily[d][evt]===undefined)ANALYTICS.daily[d][evt]=0;
    ANALYTICS.daily[d][evt]++;
    ANALYTICS.totals[evt]=(ANALYTICS.totals[evt]||0)+1;
    persist&&persist("analytics",ANALYTICS);
    if(BACKEND) SDB.postTrack(evt);   // persist the event server-side too
  }catch(e){}
}
/* Seed a week of plausible traffic once, so the dashboard chart is populated for demo. */
function seedAnalyticsDemo(){
  try{
    if(ANALYTICS.__seeded||Object.keys(ANALYTICS.daily||{}).length>2)return;
    const now=new Date();
    for(let i=6;i>=0;i--){
      const dt=new Date(now.getTime()-i*86400000).toISOString().slice(0,10);
      const view=180+Math.round(160*Math.abs(Math.sin(i*1.3+1)));
      const product=Math.round(view*(0.42+0.08*Math.sin(i)));
      const cart=Math.round(product*(0.34+0.05*Math.cos(i)));
      const order=Math.round(cart*(0.45+0.05*Math.sin(i*0.7)));
      ANALYTICS.daily[dt]={view,product,cart,order};
    }
    ANALYTICS.__seeded=true; persist&&persist("analytics",ANALYTICS);
  }catch(e){}
}

/* sequential GST invoice numbering (audit P0 #7) */
let INVOICE_SEQ = dbLoad("invoiceSeq", 42);
function nextInvoiceNo(){ INVOICE_SEQ++; persist("invoiceSeq",INVOICE_SEQ); return SETTINGS.invoicePrefix+String(INVOICE_SEQ).padStart(4,'0'); }

/* current admin user (audit P0 #4 / §7.15 — RBAC scaffolding, single-session demo) */
const ROLES = {
  owner:{label:"Owner",perms:["*"]},
  manager:{label:"Manager",perms:["orders","inventory","products","customers","returns","reports","coupons","categories","cms"]},
  fulfilment:{label:"Fulfilment",perms:["orders","inventory","returns"]},
  support:{label:"Support",perms:["orders","customers","returns"]},
  finance:{label:"Finance",perms:["orders","reports","payments"]},
  readonly:{label:"Read-only",perms:["view"]}
};
let STAFF = dbLoad("staff", [
  {id:1,name:"admin",email:"admin@suddhalaya.com",role:"owner",active:true},
  {id:2,name:"Priya (Ops)",email:"priya@suddhalaya.com",role:"fulfilment",active:true},
  {id:3,name:"Karan (Finance)",email:"karan@suddhalaya.com",role:"finance",active:true}
]);
let currentUser = {name:"admin", role:"owner"};
function can(perm){const r=ROLES[currentUser.role];if(!r)return false;return r.perms.includes("*")||r.perms.includes(perm);}

/* timestamp helper for timeline/audit entries */
function nowStamp(){
  const d=new Date();
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const pad=n=>String(n).padStart(2,'0');
  return `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- hydrate PRODUCTS / ORDERS from persistence if present ----------
   On first load the in-code seeds are used and saved. On every subsequent load
   the persisted versions win — so a stock edit at 10:00 is still there at 10:05
   after a refresh (directly fixes audit P0 #1). */
(function hydrateFromDB(){
  const savedP=dbLoad("products",null); if(savedP&&Array.isArray(savedP)&&savedP.length){PRODUCTS=savedP;}
  const savedO=dbLoad("orders",null);   if(savedO&&Array.isArray(savedO)&&savedO.length){ORDERS=savedO;}
  PRODUCTS.forEach(syncProductFromVariants);
  ORDERS.forEach(o=>{o.items=orderItemsCount(o);o.total=orderTotal(o);});
  persistAll();
})();

/* order lifecycle state machine (audit P1 #10 / §11) — allowed transitions only */
const ORDER_FLOW = {
  "payment-pending":["paid","cancelled"],
  "paid":["processing","cancelled"],
  "processing":["packed","cancelled","on-hold"],
  "packed":["shipped","on-hold"],
  "shipped":["out-for-delivery","delivered"],
  "out-for-delivery":["delivered","shipped"],
  "delivered":["returned"],
  "on-hold":["processing","cancelled"],
  "cancelled":[],
  "returned":["refunded"],
  "refunded":[]
};
const ALL_STATUSES = Object.keys(ORDER_FLOW);
function allowedNext(status){return [status, ...(ORDER_FLOW[status]||[])];}

/* ---------- helpers ---------- */
const fmt = n => "₹"+round2(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const $ = s => document.querySelector(s);
const escapeHtml = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(msg){const t=$("#toast");$("#toastMsg").textContent=msg;t.classList.add("show");clearTimeout(window._tt);window._tt=setTimeout(()=>t.classList.remove("show"),2200);}
/* per-product low-stock alert level (admin-set); 10 is the fallback, 0 = never warn */
function lowThreshold(p){ const n=p&&p.lowStock; return Number.isFinite(+n)&&+n>=0 ? +n : 10; }
function stockState(s,lo){ const t=Number.isFinite(+lo)?+lo:10; return s===0?"out":(t>0&&s<=t)?"low":"in"; }
function stockLabel(s,lo){ const t=Number.isFinite(+lo)?+lo:10; return s===0?"Out of stock":(t>0&&s<=t)?`Only ${s} left`:"In stock"; }

/* variant resolution */
function getVariant(p,vsku){ if(!p||!p.variants) return null; return p.variants.find(v=>v.sku===vsku) || p.variants[0]; }
function firstInStockVariant(p){ if(!p||!p.variants) return null; return p.variants.find(v=>v.stock>0) || p.variants[0]; }

/* multi-image gallery: derive 4 tinted views from the SVG generator so each
   product has a gallery + zoom-capable main image (placeholders flagged in audit
   are replaced here with a richer multi-angle set ready for real photography swap) */
function galleryFor(p){
  if(p && Array.isArray(p.imageUrls) && p.imageUrls.length) return p.imageUrls;   // uploaded gallery wins
  const real=[];
  for(let i=0;i<6;i++){const k=(p.sku||'')+'#'+i;if(REAL_IMAGES[k])real.push(REAL_IMAGES[k]);}
  if(real.length)return real;
  const tints=[[p.c1,p.c2],[p.c2,p.c1],['#15241a',p.c2],[p.c1,'#e8e2d0']];
  return tints.map(([a,b])=>svgURI(prodSVG(p.type,a,b)));
}

/* GST: price shown is inclusive; we back-calculate the tax component for display */
function gstComponent(amount,rate){return round2(amount - (amount/(1+rate/100)));}

/* ---------- STOREFRONT RENDER ---------- */
function renderSite(){
  $("#siteView").innerHTML = `
  <div class="announce" id="announceBar">${escapeHtml(CMS.announcement||'Free shipping over ₹999 · 100% pure, lab-tested staples')}</div>
  <header>
    <div class="wrap nav">
      <a href="#" class="brand has-logo" onclick="goHome(event)" aria-label="Suddhalaya — House of Purity home">
        <img src="${brandLogo()}" alt="Suddhalaya — House of Purity">
      </a>
      <nav aria-label="Primary">
        <ul class="menu">
          <li><a href="#/shop" data-nav="shop" onclick="return goShopPage(event)">Shop</a></li>
          <li><a href="#categories" data-nav="home" onclick="return goSection('categories',event)">Categories</a></li>
          <li><a href="#/about" data-nav="about" onclick="return goAboutPage(event)">About Us</a></li>
          <li><a href="#reviews" data-nav="home" onclick="return goSection('reviews',event)">Reviews</a></li>
          <li><a href="#contact" data-nav="home" onclick="return goSection('contact',event)">Contact</a></li>
        </ul>
      </nav>
      <div class="nav-icons">
        <button class="search-toggle" aria-label="Search" title="Search" onclick="toggleMobileSearch(event)">⌕</button>
        <div class="search-wrap">
          <div class="search-box" role="search">
            <span class="si" aria-hidden="true">⌕</span>
            <label for="storeSearch" class="sr-only">Search products</label>
            <input id="storeSearch" type="search" placeholder="Search…" autocomplete="off"
              oninput="onSearch(this.value)" onkeydown="searchKey(event)" onfocus="onSearch(this.value)" onblur="setTimeout(closeSearch,180)">
          </div>
          <div class="search-results" id="searchResults" role="listbox" aria-label="Search results"></div>
        </div>
        <button class="icon-btn wishlist-btn" id="wishBtn" aria-label="Wishlist" title="Wishlist" onclick="openWishlist()" style="display:none"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-4.5-9-9a4.5 4.5 0 0 1 9-2 4.5 4.5 0 0 1 9 2c-2 4.5-9 9-9 9z"></path></svg><span class="cart-count" id="wishCount" style="display:none" aria-hidden="true">0</span></button>
        <button class="icon-btn acct-btn" id="acctBtn" aria-label="Login / Account" title="Login / Account" onclick="openAccount()"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 20c0-3.6 3.6-6 8-6s8 2.4 8 6"></path></svg><span class="acct-label">Login</span></button>
        <button class="icon-btn" aria-label="Cart" title="Cart" onclick="openCart()">🛒<span class="cart-count" id="cartCount" style="display:none" aria-hidden="true">0</span></button>
        <button class="burger" id="burgerBtn" aria-label="Menu" aria-expanded="false" aria-controls="mobileNav" onclick="toggleMobileNav(event)">☰</button>
      </div>
    </div>
    <!-- mobile search drops into this full-width row (in flow, so it never covers page content) -->
    <div class="msearch" id="msearch"></div>
    <!-- mobile navigation: .menu is display:none below 980px, so the burger needs its own panel -->
    <nav class="mobile-nav" id="mobileNav" aria-label="Mobile" hidden>
      <ul>
        <li><a href="#/shop" onclick="return goShopPage(event)">Shop</a></li>
        <li><a href="#categories" onclick="return goSection('categories',event)">Categories</a></li>
        <li><a href="#/about" onclick="return goAboutPage(event)">About Us</a></li>
        <li><a href="#reviews" onclick="return goSection('reviews',event)">Reviews</a></li>
        <li><a href="#contact" onclick="return goSection('contact',event)">Contact</a></li>
      </ul>
    </nav>
  </header>

  <main id="main">

  <!-- HERO -->
  <section class="hero" data-page="home">
    <div class="wrap hero-grid">
      <div class="hero-copy">
        <span class="eyebrow" id="heroEyebrowEl">${escapeHtml(CMS.heroEyebrow||'')}</span>
        <h1 id="heroHeadlineEl">${CMS.heroHeadline||''}</h1>
        <p class="lead" id="heroLeadEl">${escapeHtml(CMS.heroLead||'')}</p>
        <div class="hero-cta">
          <a href="#/shop" class="btn btn-primary" onclick="return goShopPage(event)">Shop the Collection →</a>
          <a href="#/about" class="btn btn-ghost" onclick="return goAboutPage(event)">Our Story</a>
        </div>
        <div class="hero-stats" id="heroStats">
          <div><b data-count="100" data-suffix="%">100%</b><span>Lab-Tested</span></div>
          <div><b data-count="12" data-suffix="k+">12k+</b><span>Happy Homes</span></div>
          <div><b id="heroAvgRating" data-count="4.8" data-suffix="★" data-dec="1">4.8★</b><span>Avg. Rating</span></div>
        </div>
      </div>
      ${(()=>{const heroImg=CMS.heroImage||REAL_IMAGES['HERO#0'];return `<div class="hero-art" style="${heroImg?`background-image:linear-gradient(160deg,rgba(0,0,0,.05),rgba(0,0,0,.18)),url('${heroImg}');background-size:cover;background-position:center`:''}">
        <div class="ring"></div>
        ${heroImg?'':`<div style="width:78%;aspect-ratio:1;background:var(--cream);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:8%">
          <img class="seal" src="${brandLogo()}" alt="Suddhalaya seal" style="width:100%">
        </div>`}
        <div class="float-badge fb1"><span class="dot"></span>No Preservative</div>
        <div class="float-badge fb2"><span class="dot"></span>NABL Lab Tested</div>
      </div>`;})()}
    </div>
  </section>

  <!-- TRUST MARQUEE -->
  <div class="trust" data-page="home">
    <div class="trust-track">
      ${Array(3).fill(`<span>✦ No Chemicals</span><span>✦ No Preservative</span><span>✦ NABL Lab Tested</span><span>✦ Sterilized Glass Jars for Ghee Packaging</span>`).join('')}
    </div>
  </div>

  <!-- CATEGORIES -->
  <section class="block reveal" id="categories" data-page="home">
    <div class="wrap">
      <div class="sec-head"><span class="eyebrow">Curated Shelves</span><h2>Shop by Category</h2><p>Our pillars of a pure pantry — each crafted the traditional way.</p></div>
      <div class="cats reveal-stagger" id="catGrid"></div>
    </div>
  </section>

  <!-- SHOP -->
  <!-- FEATURED PRODUCTS (home) -->
  <section class="block reveal" id="featured" data-page="home">
    <div class="wrap">
      <div class="sec-head"><span class="eyebrow">The Collection</span><h2>Our Pure Essentials</h2><p>Every product is small-batch and tested for purity.</p></div>
      <div class="products" id="homeGrid"></div>
      <div style="text-align:center;margin-top:2.6rem">
        <a href="#/shop" class="btn btn-primary" onclick="return goShopPage(event)">Shop All Products →</a>
      </div>
    </div>
  </section>

  <!-- SHOP PAGE HEADER (Shop is its own page) -->
  <section class="about-page-head" id="shopTop" data-page="shop">
    <div class="wrap">
      <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="#/" onclick="goHomePage(event)">Home</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">Shop</span></nav>
      <h1>Shop All</h1>
      <p>Every product is small-batch, traceable, and tested for purity.</p>
    </div>
  </section>

  <!-- SHOP -->
  <section class="block" id="shop" data-page="shop" style="padding-top:2rem">
    <div class="wrap">
      <div class="controls">
        <div class="filters" id="filterChips" role="group" aria-label="Filter by category"></div>
        <select class="sortsel" onchange="setSort(this.value)" aria-label="Sort products">
          <option value="featured">Sort: Featured</option>
          <option value="low">Price: Low to High</option>
          <option value="high">Price: High to Low</option>
          <option value="rating">Top Rated</option>
        </select>
      </div>
      <div class="result-count" id="resultCount" style="font-size:.82rem;color:var(--muted);margin-bottom:1rem" aria-live="polite"></div>
      <div class="products" id="productGrid"></div>
    </div>
  </section>

  <!-- VALUES -->

  <!-- ABOUT PAGE HEADER (client QA r2: About lives on its own page) -->
  <section class="about-page-head" id="aboutTop" data-page="about">
    <div class="wrap">
      <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="#/" onclick="goHomePage(event)">Home</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">About Us</span></nav>
      <h1>The House of Purity</h1>
      <p>The people and the promise behind every batch — small-batch and tested for purity.</p>
    </div>
  </section>

  <!-- (Client feedback 16 Aug: "Our Story" first section removed from About) -->

  <!-- ABOUT US PAGE -->
  <section id="about" data-page="about">
    <!-- Hero / intro -->
    <div class="about-hero reveal">
      <span class="leaf-deco ld1" aria-hidden="true">🌿</span>
      <span class="leaf-deco ld2" aria-hidden="true">🍃</span>
      <div class="wrap">
        <span class="eyebrow">About Suddhalaya</span>
        <h1>A <em>House of Purity</em>, rooted in nature and tradition.</h1>
        <p class="lead">Suddhalaya was founded with a simple belief: nature, when preserved in its purest form, offers the most powerful nourishment for the body and mind. We're building more than a brand — we're creating a movement that reconnects people with nature, tradition, and mindful living.</p>
        <div class="name-meaning">
          <div class="nm-token"><b>Suddha</b><span>Pure</span></div>
          <div class="nm-plus" aria-hidden="true">+</div>
          <div class="nm-token"><b>Alaya</b><span>Home · Abode</span></div>
        </div>
        <p class="lead" style="margin-top:1.6rem;font-size:.98rem">Together, <strong style="color:var(--forest)">Suddhalaya</strong> represents a House of Purity — two Sanskrit-inspired ideas woven into one promise.</p>
      </div>
    </div>

    <!-- (Client feedback 16 Aug: "Our Mission" band removed) -->

    <!-- Founder's story -->
    <div class="block reveal">
      <div class="wrap founder-grid">
        <div class="founder-art">
          <img src="https://wihyppkqleitcrobxjcn.supabase.co/storage/v1/object/public/product-images/seed/c64d6fe5b12ef042.jpg" alt="Where technology meets the soil — Suddhalaya smart farming with A2 ghee, raw forest honey, and cold-pressed groundnut oil" loading="lazy">
        </div>
        <div class="founder-copy">
          <span class="eyebrow">The Founder's Story</span>
          <h2>Born from a blend of two worlds.</h2>
          <p>After collectively spending more than 35 years in the Information Technology industry across Europe and India — building cutting-edge innovations in Artificial Intelligence, Data Modeling, and Enterprise Systems — our founders saw how technology could transform industries and improve lives at scale.</p>
          <p>Yet one concern stayed constant: the growing difficulty of finding truly pure, authentic, and trustworthy food and wellness products. Coming from a farming background, the values of quality, honesty, and respect for nature were ingrained early — and the contrast with today's industrialized food ecosystem raised a simple question.</p>
          <p class="pull">"Why should consumers have to compromise on purity and authenticity?"</p>
          <p>Suddhalaya was created to bridge this gap — combining the discipline, traceability, and transparency of modern technology with the timeless wisdom of traditional farming and natural wellness practices. Because purity is not just a promise; it is a responsibility.</p>
          <div class="founder-stats">
            <div><b>35+</b><span>Years in technology</span></div>
            <div><b>2</b><span>Worlds, one mission</span></div>
            <div><b>100%</b><span>Rooted in trust</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Our Promise -->
    <div class="block reveal" id="promise" style="background:var(--cream-deep);border-top:1px solid var(--line)">
      <div class="wrap">
        <div class="sec-head"><span class="eyebrow">Our Promise</span><h2>Four commitments behind every product.</h2><p>The standards we hold ourselves to, before anything reaches your home.</p></div>
        <div class="promise-grid reveal-stagger">
          <div class="promise-card"><div class="pc-ic">🔬</div><h4>Purity You Can Trust</h4><p>Every product undergoes rigorous quality evaluation — laboratory testing and more than 20 quality checkpoints — for purity, safety, and authenticity. As close to nature as possible, free from unnecessary additives and shortcuts.</p></div>
          <div class="promise-card"><div class="pc-ic">🪔</div><h4>Rooted in Tradition</h4><p>Long before wellness became a trend, generations relied on nature and time-tested practices. We honour this wisdom by working with producers who still follow authentic methods that respect the ingredient and its origin.</p></div>
          <div class="promise-card"><div class="pc-ic">🤝</div><h4>Supporting the Hands That Grow</h4><p>Behind every product is a farmer, a family, and a community. Choosing Suddhalaya supports ethical sourcing and helps sustain rural livelihoods, traditional knowledge, and responsible agriculture for future generations.</p></div>
          <div class="promise-card"><div class="pc-ic">💛</div><h4>A Relationship Built on Trust</h4><p>Every product carries a simple promise: if we wouldn't proudly share it with our own family, we won't share it with yours. More than a product — a relationship built on trust.</p></div>
        </div>
      </div>
    </div>

    <!-- Closing pledge -->
    <div class="about-pledge reveal">
      <div class="wrap">
        <div class="q-mark" aria-hidden="true">"</div>
        <h2>Nature, when respected and preserved, offers the finest nourishment for body, mind, and soul.</h2>
      </div>
    </div>
  </section>
  <section class="block reveal" id="reviews" data-page="home" style="background:var(--cream-deep);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
    <div class="wrap">
      <div class="sec-head"><h2>What Our Customers Say</h2><p>Real words from real kitchens.</p></div>
      <div class="tests reveal-stagger" id="homeReviews"></div>
      <div class="review-cta">
        <button class="btn btn-gold" onclick="toggleHomeReviewForm()" id="homeReviewToggle">✍ Write a Review</button>
        <div class="home-review-form" id="homeReviewForm">
          <div style="font-family:var(--font-display);font-size:1.15rem;margin-bottom:.3rem">Share your experience</div>
          <div class="hr-stars" id="hrStars" role="radiogroup" aria-label="Your rating">${[1,2,3,4,5].map(n=>`<span role="radio" aria-label="${n} star" tabindex="0" onclick="setHomeStars(${n})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();setHomeStars(${n})}">★</span>`).join('')}</div>
          <input id="hrName" placeholder="Your name" aria-label="Your name">
          <input id="hrPlace" placeholder="Your city (optional)" aria-label="Your city">
          <textarea id="hrText" placeholder="Tell us what you loved…" aria-label="Your review"></textarea>
          <div id="hrImgPrev"></div>
          <label class="rev-img-btn">📷 Add a photo (optional)<input type="file" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="pickReviewImg(this,'home')"></label>
          <button class="btn btn-primary" style="margin-top:.9rem;width:100%;justify-content:center" onclick="submitHomeReview()">Publish Review</button>
        </div>
      </div>
    </div>
  </section>

  <!-- (Client QA r2: "Pantry Club" subscription section removed; #contact now lives on the footer Get-in-Touch column) -->

  <!-- ACCOUNT PAGE (Your Account opens as its own page) -->
  <section id="accountPage" data-page="account" style="display:none"></section>

  <!-- PRIVACY POLICY PAGE (client feedback 16 Aug: footer link was broken) -->
  <section class="about-page-head" id="privacyTop" data-page="privacy">
    <div class="wrap">
      <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="#/" onclick="goHomePage(event)">Home</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">Privacy Policy</span></nav>
      <h1>Privacy Policy</h1>
      <p>How Suddhalaya collects, uses, and protects your information.</p>
    </div>
  </section>
  <section class="block" data-page="privacy"><div class="wrap"><div class="policy">
    <p class="policy-updated">Last updated: August 2026</p>
    <p>Suddhalaya Organic Pvt Ltd ("Suddhalaya", "we", "us") respects your privacy and is committed to protecting the personal data you share with us. This policy explains what we collect, how we use it, and the choices you have. It applies to www.suddhalaya.com and any orders placed with us.</p>
    <h3>1. Information we collect</h3>
    <ul>
      <li><b>Information you give us</b> — name, email, mobile number, delivery address, and order details when you create an account, place an order, or contact us.</li>
      <li><b>Payment information</b> — payments are processed by our payment partner (Razorpay). We do not store your full card or UPI credentials on our servers.</li>
      <li><b>Automatic information</b> — device, browser, and usage data collected through cookies and analytics to help the site work and improve.</li>
    </ul>
    <h3>2. How we use your information</h3>
    <ul>
      <li>To process, fulfil, and deliver your orders and send order updates.</li>
      <li>To provide customer support and respond to your requests.</li>
      <li>To send transactional emails (order confirmation, password reset, back-in-stock) and, with your consent, updates and offers.</li>
      <li>To improve our products, website, and services, and to keep the site secure.</li>
      <li>To meet legal, tax, and accounting obligations.</li>
    </ul>
    <h3>3. Sharing your information</h3>
    <p>We <b>do not sell</b> your personal data. We share it only with trusted partners who help us run the business: payment processors, courier/logistics partners for delivery, email/SMS providers, and IT service providers — each bound to use it only for the services they provide. We may also disclose information where required by law.</p>
    <h3>4. Cookies &amp; analytics</h3>
    <p>We use essential cookies to run the site, and — only with your consent — analytics and marketing cookies to understand usage and improve your experience. You can accept or decline non-essential cookies via the cookie banner and control cookies through your browser settings.</p>
    <h3>5. Data security</h3>
    <p>We use appropriate technical and organisational measures — including encryption in transit (HTTPS) and access controls — to protect your data. No method of transmission or storage is completely secure, but we work continuously to safeguard your information.</p>
    <h3>6. Data retention</h3>
    <p>We keep personal data only as long as needed for the purposes above, including order history, warranty/returns, and legal or tax requirements, after which it is deleted or anonymised.</p>
    <h3>7. Your rights</h3>
    <p>You may request access to, correction of, or deletion of your personal data, and you may withdraw consent for marketing at any time. To exercise these rights, email <a href="mailto:support@suddhalaya.com">support@suddhalaya.com</a>.</p>
    <h3>8. Children's privacy</h3>
    <p>Our site is intended for adults. We do not knowingly collect personal data from children under 18.</p>
    <h3>9. Changes to this policy</h3>
    <p>We may update this policy from time to time. The latest version will always be available on this page with the updated date above.</p>
    <h3>10. Contact us</h3>
    <p>Questions about this policy or your data? Write to <a href="mailto:support@suddhalaya.com">support@suddhalaya.com</a>.</p>
  </div></div></section>

  <!-- RETURN POLICY PAGE (client feedback 16 Aug: dedicated page + footer link) -->
  <section class="about-page-head" id="returnsTop" data-page="returns">
    <div class="wrap">
      <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="#/" onclick="goHomePage(event)">Home</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">Return &amp; Refund Policy</span></nav>
      <h1>Return &amp; Refund Policy</h1>
      <p>Returns are accepted within 7 days for damaged or defective items.</p>
    </div>
  </section>
  <section class="block" data-page="returns"><div class="wrap"><div class="policy">
    <p class="policy-updated">Last updated: August 2026</p>
    <p>Because our products are food and wellness items, returns are handled with care for hygiene and safety. We stand fully behind the quality of every batch — if something arrives damaged, defective, or incorrect, we will make it right.</p>
    <h3>1. Eligibility — 7-day window</h3>
    <p>You may request a return or replacement within <b>7 days of delivery</b> if the item is:</p>
    <ul>
      <li><b>Damaged</b> in transit (broken seal, leaked, or broken jar/bottle),</li>
      <li><b>Defective</b> or spoiled, or</li>
      <li><b>Incorrect</b> — not the product you ordered.</li>
    </ul>
    <h3>2. Proof required</h3>
    <p>To help us process your request quickly, please share clear <b>photos of the item, the packaging, and the batch/label</b> along with your order number. This also helps us improve our packing and quality checks.</p>
    <h3>3. How to initiate a return</h3>
    <ol>
      <li>Email <a href="mailto:support@suddhalaya.com">support@suddhalaya.com</a> within 7 days of delivery with your <b>order number</b> and <b>photos</b>.</li>
      <li>Our team will review and respond, usually within 2 business days.</li>
      <li>If approved, we will arrange a pickup or ask you to return the item as advised.</li>
    </ol>
    <h3>4. Replacement or refund</h3>
    <p>Once approved (and the item received/verified where applicable), you can choose a <b>free replacement</b> or a <b>refund</b>. Refunds are issued to your original payment method within <b>5–7 business days</b>. For Cash-on-Delivery orders, refunds are issued via bank transfer/UPI.</p>
    <h3>5. Exclusions</h3>
    <ul>
      <li>Items that are <b>opened or partially used</b> are not eligible unless they were damaged, defective, or incorrect on arrival — for food-safety and hygiene reasons.</li>
      <li>Requests raised after the 7-day window.</li>
      <li>Damage caused by misuse or improper storage after delivery.</li>
    </ul>
    <h3>6. Return shipping</h3>
    <p>For damaged, defective, or incorrect items, return shipping is on us. We'll arrange a pickup or reimburse reasonable return postage where a pickup isn't available.</p>
    <h3>7. Contact</h3>
    <p>Need help with a return? Write to <a href="mailto:support@suddhalaya.com">support@suddhalaya.com</a> and we'll take care of it.</p>
  </div></div></section>

  <!-- FOOTER -->
  </main>
  <footer>
    <div class="foot-top">
      <div class="foot-leaf fl-tr" aria-hidden="true">
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" fill="#9cb37a">
          <path d="M180 20c-50 6-86 36-96 84 48-4 88-40 100-78 1-4-1-7-4-6z" opacity=".55"/>
          <path d="M150 30c-30 24-44 60-40 96 30-22 50-58 48-92-1-4-5-6-8-4z" opacity=".45"/>
          <path d="M120 132c20-30 48-52 78-62" stroke="#9cb37a" stroke-width="2" fill="none" opacity=".5"/>
        </svg>
      </div>
      <div class="foot-leaf fl-bl" aria-hidden="true">
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" fill="#7c9a52">
          <path d="M20 180c50-6 86-36 96-84-48 4-88 40-100 78-1 4 1 7 4 6z" opacity=".6"/>
          <path d="M50 170c30-24 44-60 40-96-30 22-50 58-48 92 1 4 5 6 8 4z" opacity=".5"/>
          <path d="M80 68c-20 30-48 52-78 62" stroke="#7c9a52" stroke-width="2" fill="none" opacity=".5"/>
        </svg>
      </div>
      <div class="wrap">
        <div class="foot-grid">
          <!-- Brand + badges -->
          <div class="foot-brand">
            <img src="${brandLogo()}" alt="Suddhalaya — House of Purity">
          </div>

          <!-- Shop -->
          <div class="foot-col">
            <h5><svg viewBox="0 0 24 24" fill="none"><path d="M6 7h12l1 13H5L6 7z" stroke="currentColor"/><path d="M9 7a3 3 0 0 1 6 0" stroke="currentColor"/></svg>Shop</h5>
            <a href="#shop" onclick="return goShop('all',event)">All Products <span class="chev">›</span></a>
            <a href="#shop" onclick="return goShop('best',event)">Best Sellers <span class="chev">›</span></a>
            <a href="#shop" onclick="return goShop('A2 Dairy',event)">A2 Dairy <span class="chev">›</span></a>
            <a href="#shop" onclick="return goShop('Cold-Pressed Oils',event)">Cold-Pressed Oils <span class="chev">›</span></a>
            <a href="#shop" onclick="return goShop('Spices',event)">Spices <span class="chev">›</span></a>
          </div>

          <!-- About -->
          <div class="foot-col">
            <h5><svg viewBox="0 0 24 24" fill="none"><path d="M12 4c-3 3-6 4-6 8a6 6 0 0 0 12 0c0-4-3-5-6-8z" stroke="currentColor"/></svg>About Us</h5>
            <a href="#about" onclick="return goSection('about',event)">About Suddhalaya <span class="chev">›</span></a>
            <a href="#promise" onclick="return goSection('promise',event)">Our Promise <span class="chev">›</span></a>
          </div>

          <!-- Get in touch -->
          <div class="foot-col foot-contact" id="contact">
            <h5><svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16v12H4z" stroke="currentColor"/><path d="M4 7l8 6 8-6" stroke="currentColor"/></svg>Get in Touch</h5>
            <div class="ct-row"><svg viewBox="0 0 24 24"><path d="M5 4h3l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg><a id="footPhone" href="tel:+919368140887">+91 9368140887</a></div>
            <div class="ct-row"><svg viewBox="0 0 24 24"><path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/></svg><a id="footEmail" href="mailto:support@suddhalaya.com">support@suddhalaya.com</a></div>
            <div class="ct-row"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span id="footHours">Mon – Sat: 9:00 AM – 7:00 PM</span></div>
            <div class="ct-row"><svg viewBox="0 0 24 24"><path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg><span id="footAddress">Bengaluru, Karnataka, India</span></div>
            <div class="foot-follow">
              <h5>Follow Us</h5>
              <div class="foot-social">
                <a id="footFb" href="https://facebook.com/suddhalaya" target="_blank" rel="noopener" aria-label="Facebook"><svg viewBox="0 0 24 24"><path d="M14 9h2.5l.5-3H14V4.5c0-.9.3-1.5 1.6-1.5H17V.3C16.7.2 15.8 0 14.7 0 12.3 0 10.7 1.5 10.7 4.2V6H8v3h2.7v9H14V9z"/></svg></a>
                <a id="footIg" href="https://instagram.com/suddhalaya" target="_blank" rel="noopener" aria-label="Instagram"><svg viewBox="0 0 24 24"><path d="M12 2.2c3.2 0 3.6 0 4.9.07 1.2.06 1.8.25 2.2.42.6.22 1 .48 1.4.9.42.4.68.8.9 1.4.17.4.36 1 .42 2.2.07 1.3.07 1.7.07 4.9s0 3.6-.07 4.9c-.06 1.2-.25 1.8-.42 2.2-.22.6-.48 1-.9 1.4-.4.42-.8.68-1.4.9-.4.17-1 .36-2.2.42-1.3.07-1.7.07-4.9.07s-3.6 0-4.9-.07c-1.2-.06-1.8-.25-2.2-.42-.6-.22-1-.48-1.4-.9-.42-.4-.68-.8-.9-1.4-.17-.4-.36-1-.42-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.07-4.9c.06-1.2.25-1.8.42-2.2.22-.6.48-1 .9-1.4.4-.42.8-.68 1.4-.9.4-.17 1-.36 2.2-.42C8.4 2.2 8.8 2.2 12 2.2Zm0 1.8c-3.1 0-3.5 0-4.7.07-1.1.05-1.7.24-2.1.4-.5.2-.9.43-1.3.83-.4.4-.63.8-.83 1.3-.16.4-.35 1-.4 2.1C2.6 9.7 2.6 10.1 2.6 12s0 2.3.07 3.5c.05 1.1.24 1.7.4 2.1.2.5.43.9.83 1.3.4.4.8.63 1.3.83.4.16 1 .35 2.1.4 1.2.07 1.6.07 4.7.07s3.5 0 4.7-.07c1.1-.05 1.7-.24 2.1-.4.5-.2.9-.43 1.3-.83.4-.4.63-.8.83-1.3.16-.4.35-1 .4-2.1.07-1.2.07-1.6.07-3.5s0-2.3-.07-3.5c-.05-1.1-.24-1.7-.4-2.1-.2-.5-.43-.9-.83-1.3-.4-.4-.8-.63-1.3-.83-.4-.16-1-.35-2.1-.4C15.5 4 15.1 4 12 4Zm0 3.1a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8Zm0 1.8a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2Zm5.1-.3a1.15 1.15 0 1 1-2.3 0 1.15 1.15 0 0 1 2.3 0Z"/></svg></a>
                <a id="footLi" href="https://linkedin.com/company/suddhalaya" target="_blank" rel="noopener" aria-label="LinkedIn"><svg viewBox="0 0 24 24"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3V9zm6 0h3.8v1.7h.05c.53-1 1.83-2.05 3.76-2.05C20.6 8.65 22 10.6 22 14v7h-4v-6.2c0-1.5 0-3.4-2.1-3.4s-2.4 1.6-2.4 3.3V21H9V9z"/></svg></a>
              </div>
            </div>
          </div>
        </div>

        <!-- (Client QA r2: "greener tomorrow" newsletter banner removed) -->
      </div>
    </div>

    <!-- Dark payments strip -->
    <div class="foot-strip">
      <div class="wrap">
        <div class="fs-row">
          <div class="fs-feat">
            <svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z"/><path d="M9.5 12l2 2 3.5-4"/></svg>
            <div><b>Secure Payments</b><small>100% protected checkout</small></div>
          </div>
          <div class="fs-pays">
            <span class="pay-visa">VISA</span>
            <span class="pay-mc"><i></i><i></i></span>
            <span class="pay-mark">RuPay</span>
            <span class="pay-mark">UPI</span>
          </div>
          <div class="fs-divider"></div>
          <div class="fs-feat">
            <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/></svg>
            <div><b>Easy Returns</b><small id="footReturns">${escapeHtml(CMS.returnPolicy||'Hassle-free within 7 days')}</small></div>
          </div>
        </div>
        <div class="foot-legal">
          <a href="#/privacy" onclick="return goPrivacyPage(event)">Privacy Policy</a>
          <span class="foot-legal-sep" aria-hidden="true">·</span>
          <a href="#/returns" onclick="return goReturnPage(event)">Return &amp; Refund Policy</a>
        </div>
        <div class="foot-bottom">
          <div>© 2026 Suddhalaya Organic Pvt Ltd · <a href="mailto:business@suddhalaya.com">business@suddhalaya.com</a></div>
          <div class="iti-credit">Designed &amp; Engineered by <a href="https://www.imperialtechinnovations.com/" target="_blank" rel="noopener">Imperial Tech Innovations</a></div>
        </div>
      </div>
    </div>
  </footer>
  `;
  renderFilters();
  renderProducts();
  updateCartUI();
}

/* ---------- products / filters ---------- */
/* activeFilter is "All", a single category name, or a CATS group label.
   activeFilterCats holds the actual product categories to match against. */
function renderFilters(){
  const cats=["All",...new Set(PRODUCTS.map(p=>p.cat))];
  $("#filterChips").innerHTML=cats.map(c=>`<button class="chip ${c===activeFilter?'active':''}" onclick="setFilter('${c}')">${c}</button>`).join('');
}
function setFilter(c){activeFilter=c;activeFilterCats=(c==="All")?null:[c];activeTag=null;renderFilters();renderProducts();}
/* Footer / menu shop links: real category, All, Best Sellers (tag) or New Arrivals (newest). */
function goShop(kind,e){
  if(e&&e.preventDefault)e.preventDefault();
  if(typeof showSitePage==='function') showSitePage('shop');   // Shop is its own page
  activeTag=null;
  if(kind==='all'){activeFilter='All';activeFilterCats=null;}
  else if(kind==='best'){activeFilter='Best Sellers';activeFilterCats=null;activeTag='best';}
  else {activeFilter=kind;activeFilterCats=[kind];}
  renderFilters();renderProducts();
  closeMobileNav&&closeMobileNav();
  window.scrollTo(0,0);
  return false;
}
/* Shop-by-category card click — maps a CATS card to one or more real categories */
function filterToCat(ci){
  const card=CATS[ci]; if(!card)return;
  activeFilter=card.name;
  activeFilterCats=card.cats&&card.cats.length?card.cats.slice():[card.name];
  activeTag=null;
  if(typeof showSitePage==='function') showSitePage('shop');   // category tiles open the Shop page filtered
  renderFilters();renderProducts();
  window.scrollTo(0,0);
}
/* Route to the Shop page filtered to a single admin category (by name). */
function filterToCatName(name){
  activeFilter=name;
  activeFilterCats=[name];
  activeTag=null;
  if(typeof showSitePage==='function') showSitePage('shop');
  renderFilters();renderProducts();
  window.scrollTo(0,0);
}
/* Eyebrow line for a storefront tile: reuse the curated CATS label if the name
   matches, else fall back to the category's own SEO blurb. */
function catSub(c){
  const m=CATS.find(x=>x.name===c.name || (x.cats&&x.cats.includes(c.name)));
  if(m&&m.sub) return m.sub;
  const s=(c.seo||'').trim();
  return s.length>24 ? s.slice(0,22).trim()+'…' : s;
}
/* Render the "Shop by Category" tiles from the LIVE admin categories (so a newly
   added category shows up and routes), each tile filtering to its own category. */
function renderCategoryTiles(){
  const grid=$("#catGrid"); if(!grid) return;
  const cats=(CATEGORIES||[]).slice().sort((a,b)=>(a.order||0)-(b.order||0));
  grid.innerHTML=cats.map(c=>{
    const img=c.image||catImg(c.name);
    const nm=(c.name||'').replace(/'/g,"\\'");
    return `<div class="cat" role="button" tabindex="0" onclick="filterToCatName('${nm}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();filterToCatName('${nm}');}">
      <div class="cat-bg" style="${img?`background-image:linear-gradient(160deg,rgba(0,0,0,.18),rgba(0,0,0,.42)),url('${img}');background-size:cover;background-position:center`:`background:linear-gradient(160deg,var(--forest),var(--forest-2,#2d4a2e))`}"></div>
      <div class="ctext"><small>${escapeHtml(catSub(c))}</small><h4>${escapeHtml(c.name)}</h4></div>
    </div>`;
  }).join('');
}
/* legacy text matcher kept for any other callers */
function filterTo(word){
  const match=PRODUCTS.find(p=>p.cat.toLowerCase().includes(word.toLowerCase()));
  if(match){activeFilter=match.cat;activeFilterCats=[match.cat];if(typeof showSitePage==='function')showSitePage('shop');renderFilters();renderProducts();window.scrollTo(0,0);}
}
function setSort(s){activeSort=s;renderProducts();}
function getVisible(){
  // storefront never shows drafts (admin loads drafts into PRODUCTS for management)
  let list=PRODUCTS.filter(p=>!p.draft && (!activeFilterCats||activeFilterCats.includes(p.cat)));
  if(activeTag==='best') list=list.filter(p=>(p.tag||'').toLowerCase().includes('best'));
  if(activeSort==="low")list.sort((a,b)=>a.price-b.price);
  if(activeSort==="high")list.sort((a,b)=>b.price-a.price);
  if(activeSort==="rating")list.sort((a,b)=>b.rating-a.rating);
  return list;
}
/* Reusable product card — used by the Shop grid and the Home featured grid. */
function productCardHTML(p){
  const off=Math.round((1-p.price/p.mrp)*100);
  const ss=stockState(p.stock,lowThreshold(p));
  const priceLabel = (p.variants&&p.variants.length>1)?`From ${fmt(p.price)}`:fmt(p.price);
  return `<article class="card">
      <div class="thumb">
        ${p.tag?`<span class="tag ${p.tag==='Bestseller'?'bestseller':''}">${p.tag}</span>`:''}
        ${currentShopper()?`<button class="wish ${WISH.has(p.id)?'on':''}" aria-label="${WISH.has(p.id)?'Remove from':'Add to'} wishlist" aria-pressed="${WISH.has(p.id)}" onclick="toggleWish(${p.id},event)">${WISH.has(p.id)?'♥':'♡'}</button>`:''}
        <div class="ph"><img src="${primaryImg(p)}" alt="${escapeHtml(p.name)} — ${escapeHtml(p.cat)}" style="cursor:pointer" onclick="openProduct(${p.id})" onkeydown="if(event.key==='Enter')openProduct(${p.id})" tabindex="0" role="button"></div>
      </div>
      <div class="info">
        <div class="cat-label">${p.cat}</div>
        <h3 style="cursor:pointer" onclick="openProduct(${p.id})" onkeydown="if(event.key==='Enter')openProduct(${p.id})" tabindex="0" role="button">${p.name}</h3>
        <div class="stars" aria-label="Rated ${p.rating} out of 5 from ${p.reviews} reviews">★★★★★ <span>${p.rating} (${p.reviews})</span></div>
        <div class="price"><b>${priceLabel}</b><s>${fmt(p.mrp)}</s><span class="off">${off}% off</span></div>
        <div class="stockline ${ss}"><span class="sd"></span>${stockLabel(p.stock,lowThreshold(p))}</div>
        <button class="btn ${p.stock===0?'btn-notify':'btn-primary'} add" onclick="${p.stock===0?`notifyMe(${p.id},event)`:`openProduct(${p.id})`}">${p.stock===0?'🔔 Notify Me':(p.variants&&p.variants.length>1?'Choose Options':'Add to Cart')}</button>
      </div>
    </article>`;
}
function renderProducts(){
  const grid=$("#productGrid");
  const list=getVisible();
  const rc=$("#resultCount"); if(rc) rc.textContent=`${list.length} product${list.length!==1?'s':''}${activeFilter!=='All'?' in '+activeFilter:''}`;
  if(grid) grid.innerHTML=list.length
    ? list.map(productCardHTML).join('')
    : `<div class="shop-empty" style="grid-column:1/-1;text-align:center;padding:3.5rem 1rem;color:var(--muted)"><div style="font-size:2.2rem;margin-bottom:.6rem">🧺</div><p style="font-size:1.05rem;color:var(--ink);margin-bottom:.35rem">No products in <b>${activeFilter==='All'?'this selection':escapeHtml(activeFilter)}</b> yet.</p><p style="font-size:.88rem">New stock is on its way — <a href="#" onclick="setFilter('All');return false" style="color:var(--forest);font-weight:600;text-decoration:underline">browse all products</a>.</p></div>`;
  renderHomeGrid();   // keep the home featured grid in sync
  injectProductSchema(list);
}
/* Home page featured products — a curated preview (unaffected by shop filters);
   the "Shop All Products" button leads to the full catalogue on the Shop page. */
function renderHomeGrid(){
  const grid=$("#homeGrid"); if(!grid) return;
  const list=PRODUCTS.filter(p=>!p.draft).slice(0,8);
  grid.innerHTML=list.map(productCardHTML).join('');
}
function toggleWish(id,e){
  if(e)e.stopPropagation();
  if(!currentShopper()){ toast('Please sign in to use your wishlist'); accountTab='login'; renderAccountModal(); return; }
  WISH.has(id)?WISH.delete(id):WISH.add(id); saveWish();
  const c=$("#wishCount"); if(c){ c.textContent=WISH.size; c.style.display=WISH.size?'flex':'none'; }
  renderProducts();
  toast(WISH.has(id)?'Added to wishlist ♥':'Removed from wishlist');
}

/* ---------- cart (variant-aware, persistent, GST + coupon) ---------- */
function cartLineMeta(item){
  const p=PRODUCTS.find(x=>x.id===item.id); if(!p) return null;
  const v=getVariant(p,item.vsku)||{}; return {p,v};
}
/* Client request: a working "Notify Me" for out-of-stock products — collects an email
   (prefilled for signed-in shoppers) and adds it to the back-in-stock waitlist. */
function notifyMe(id,e){
  if(e){e.stopPropagation();e.preventDefault();}
  const p=PRODUCTS.find(x=>x.id===id); if(!p) return;
  const acct=currentShopper();
  $("#modalRoot").innerHTML=`<div class="modal-bg" onclick="closeModal()"></div>
   <div class="modal-card" role="dialog" aria-modal="true" style="max-width:440px"><div class="modal-head"><h3>Notify me</h3><button class="x" aria-label="Close" onclick="closeModal()">×</button></div>
   <div class="modal-body">
     <p style="font-size:.9rem;color:var(--muted);margin:-.3rem 0 1.1rem"><b style="color:var(--ink)">${escapeHtml(p.name)}</b> is out of stock. Leave your email and we'll let you know the moment it's back.</p>
     <div class="field"><label for="notifyEmail">Email</label><input id="notifyEmail" type="email" value="${escapeHtml((acct&&acct.email)||'')}" placeholder="you@email.com" onkeydown="if(event.key==='Enter')submitNotify(${id})"></div>
     <div class="notify-msg" id="notifyMsg" aria-live="polite"></div>
     <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="submitNotify(${id})">🔔 Notify me when available</button>
   </div></div>`;
  $("#modalRoot").classList.add('show');
  setTimeout(()=>$("#notifyEmail")?.focus(),30);
}
async function submitNotify(id){
  const p=PRODUCTS.find(x=>x.id===id); if(!p) return;
  const email=($("#notifyEmail")?.value||'').trim();
  const msg=$("#notifyMsg");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ if(msg){msg.className='notify-msg no';msg.textContent='Please enter a valid email address.';} return; }
  const btn=$("#modalRoot .btn-primary"); if(btn){btn.disabled=true;btn.textContent='Saving…';}
  let ok=true;
  if(BACKEND){
    const r=await SDB.stockNotify({product_sku:p.sku, email});
    ok=!!(r&&r.ok);
    if(!ok){ if(msg){msg.className='notify-msg no';msg.textContent=(r&&r.err)||'Could not save — please try again.';} if(btn){btn.disabled=false;btn.textContent='🔔 Notify me when available';} return; }
  } else {
    try{ const k='sdl_stock_notify'; const arr=JSON.parse(localStorage.getItem(k)||'[]'); if(!arr.some(x=>x.sku===p.sku&&x.email===email)) arr.push({sku:p.sku,email}); localStorage.setItem(k,JSON.stringify(arr)); }catch(e){}
  }
  closeModal();
  toast(`Done! We'll email ${email} when ${p.name} is back in stock.`);
}
function addToCart(id,vsku,qty){
  const p=PRODUCTS.find(x=>x.id===id); if(!p) return;
  const v=vsku?getVariant(p,vsku):firstInStockVariant(p);
  if(!v||v.stock===0){toast("We'll notify you when back in stock");return;}
  qty=Math.max(1,qty||1);
  const ex=CART.find(x=>x.id===id&&x.vsku===v.sku);
  const have=ex?ex.qty:0;
  if(have+qty>v.stock){ if(have>=v.stock){toast("Reached available stock");return;} qty=v.stock-have; }
  if(ex)ex.qty+=qty; else CART.push({id,vsku:v.sku,qty});
  saveCart();updateCartUI();track('cart');toast(`${p.name} (${v.label}) added to cart`);
}
function changeQty(id,vsku,d){
  const item=CART.find(x=>x.id===id&&x.vsku===vsku);if(!item)return;
  const meta=cartLineMeta(item);item.qty+=d;
  if(item.qty<=0)CART=CART.filter(x=>!(x.id===id&&x.vsku===vsku));
  else if(meta&&item.qty>meta.v.stock){item.qty=meta.v.stock;toast("Reached available stock");}
  saveCart();updateCartUI();renderCartItems();
}
function removeItem(id,vsku){CART=CART.filter(x=>!(x.id===id&&x.vsku===vsku));saveCart();updateCartUI();renderCartItems();}
function cartSubtotal(){return CART.reduce((s,i)=>{const m=cartLineMeta(i);return s+(m?m.v.price*i.qty:0);},0);}
function cartCount(){return CART.reduce((s,i)=>s+i.qty,0);}
/* eligible subtotal for a coupon: whole cart, or only the matching SKUs for a
   product-scoped coupon (client #Phase4.2). productSkus hold variant SKUs. */
function couponEligible(c, sub){
  if(c && (c.scope==='products'||c.scope==='user_products') && Array.isArray(c.productSkus)){
    return round2(CART.reduce((s,i)=>{const m=cartLineMeta(i);if(!m)return s;return s+(c.productSkus.includes(i.vsku)?m.v.price*i.qty:0);},0));
  }
  return sub;
}
function couponDiscount(sub){
  if(!appliedCoupon)return 0;
  const c=(BACKEND && COUPON_INFO) ? COUPON_INFO : COUPONS[appliedCoupon];
  if(!c)return 0;
  const eligible=couponEligible(c, sub);
  if(eligible<=0) return 0;
  let d = c.type==='pct'?round2(eligible*c.value/100):round2(Math.min(c.value,eligible));
  // Audit BUG-11: honour the max-discount cap the coupon chip already advertises
  // ("15% off (max ₹200)"). The server caps it too — this keeps the cart total the
  // customer is shown identical to the total they are charged.
  if(+c.cap > 0) d = round2(Math.min(d, +c.cap));
  return d;
}
/* safe applied-coupon description across both modes */
function couponDescText(){
  if(!appliedCoupon) return '';
  const c=(BACKEND && COUPON_INFO) ? COUPON_INFO : COUPONS[appliedCoupon];
  return c ? ('Applied: '+(c.desc||appliedCoupon)) : '';
}
function cartGST(){ // weighted GST included within line prices
  return round2(CART.reduce((s,i)=>{const m=cartLineMeta(i);if(!m)return s;return s+gstComponent(m.v.price*i.qty,m.p.gst||0);},0));
}
/* Single source of truth for all money breakdowns.
   Stored prices are GST-INCLUSIVE. We split each discounted line into its
   base (ex-GST) and tax components, kept exact to the paisa so the visible
   rows always add up to the same grand total (no rounding loss). */
function cartBreakdown(){
  const gross=round2(cartSubtotal());                // GST-inclusive goods value
  const disc=round2(couponDiscount(gross));          // coupon off the gross
  const afterDisc=round2(gross-disc);                 // payable goods (GST-incl)
  // GST share of the *discounted* goods, weighted by each line's rate
  const ratio=gross>0?afterDisc/gross:0;
  const gstRaw=CART.reduce((s,i)=>{const m=cartLineMeta(i);if(!m)return s;
    return s+gstComponent(m.v.price*i.qty*ratio,m.p.gst||0);},0);
  // Keep exact paise; derive base so base + gst === afterDisc to the paisa
  const gst=round2(gstRaw);
  const base=round2(afterDisc-gst);                  // ex-GST base of payable goods
  const ship=cartShippingFee(afterDisc);
  const total=round2(base+gst+ship);                 // visible rows always sum to this
  return {gross,disc,afterDisc,base,gst,ship,total};
}
/* Client #3: shipping is configurable two ways —
   (1) basket rule: free over SETTINGS.freeShipThreshold, else SETTINGS.flatShip;
   (2) per-product surcharge: each product may carry its own `shipFee` (heavy/fragile
   items) added on top, counted once per distinct product. Free-shipping basket
   waives everything. */
function cartShippingFee(afterDisc){
  if(SETTINGS.freeShipThreshold>0 && afterDisc>=SETTINGS.freeShipThreshold) return 0;
  const base=+SETTINGS.flatShip||0;
  const ids=[...new Set(CART.map(i=>i.id))];
  const perProduct=ids.reduce((s,id)=>{const p=PRODUCTS.find(x=>x.id===id);return s+((p&&+p.shipFee)||0);},0);
  return round2(base+perProduct);
}
/* GST-inclusive summary shared by cart + checkout.
   Client QA r2: don't show GST as a separate line — prices already include it. */
function summaryRows(b){
  return `
    <div class="row"><span>Subtotal</span><span>${fmt(b.gross)}</span></div>
    ${b.disc>0?`<div class="row discount"><span>Discount (${appliedCoupon})</span><span>−${fmt(b.disc)}</span></div>`:''}
    <div class="row"><span>Shipping</span><span>${b.ship===0?'Free':'+ '+fmt(b.ship)}</span></div>
    <div class="row total"><span>Total</span><span>${fmt(b.total)}</span></div>
    <div class="row tax-note"><span>Inclusive of all taxes (GST)</span></div>`;
}
async function applyCoupon(){
  const code=($("#couponInput")?.value||"").trim().toUpperCase();
  // Render first, THEN write the message: renderCartItems() rebuilds #couponMsg
  // from scratch, so setting it before the re-render silently wipes the text
  // (this is why an invalid code showed no error).
  const ok=(t)=>{renderCartItems();const m=$("#couponMsg");if(m){m.className="coupon-msg ok";m.textContent=t;}toast("Coupon applied");};
  const no=(t)=>{appliedCoupon=null;COUPON_INFO=null;renderCartItems();const m=$("#couponMsg");if(m){m.className="coupon-msg no";m.textContent=t;}};
  if(!code){no("Enter a code.");return;}
  if(BACKEND){
    const items=CART.map(i=>{const m=cartLineMeta(i);return {sku:i.vsku, amount:(m?m.v.price*i.qty:0)};});
    const r=await SDB.validateCoupon(code, round2(cartSubtotal()), items);
    if(r&&r.valid){ appliedCoupon=code; COUPON_INFO={type:r.type,value:r.value,desc:r.desc,minCart:r.minCart,cap:r.cap||0,scope:r.scope,productSkus:r.productSkus||[]}; ok("Applied: "+(r.desc||code)); }
    else no((r&&r.reason)||"Invalid code.");
    return;
  }
  // ---- offline scope-aware validation ----
  const c=COUPONS[code];
  if(!c){no("Invalid code. Try PURE10 or FIRST100.");return;}
  const sub=round2(cartSubtotal());
  if(sub < (c.minCart||0)){ no("Add ₹"+(c.minCart)+"+ to use this code."); return; }
  if(c.scope==='users'||c.scope==='user_products'){
    const u=currentShopper(); const em=((u&&u.email)||'').toLowerCase();
    if(!em || !(c.userEmails||[]).map(e=>String(e).toLowerCase()).includes(em)){ no("This code isn't available on your account."); return; }
  }
  if(c.scope==='products'||c.scope==='user_products'){
    if(couponEligible(c, sub) <= 0){ no("This code applies to products not in your cart."); return; }
  }
  appliedCoupon=code; ok("Applied: "+(c.desc||code));
}
/* drop cart items whose product/variant no longer exists (self-heals stale carts) */
function pruneCart(silent){
  if(!PRODUCTS||!PRODUCTS.length) return;
  const before=CART.length;
  CART=CART.filter(i=>cartLineMeta(i));
  if(CART.length!==before){ saveCart(); if(!silent) toast("Removed items that are no longer available"); }
}
function updateCartUI(){pruneCart(true);const c=$("#cartCount");if(c){c.textContent=cartCount();c.style.display=cartCount()?'flex':'none';}}
function openCart(){pruneCart();renderCartItems();$("#overlay").classList.add("show");$("#cartDrawer").classList.add("show");$("#cartDrawer").setAttribute('aria-hidden','false');const x=$("#cartDrawer .x");x&&x.focus();}
function closeCart(){$("#overlay").classList.remove("show");$("#cartDrawer").classList.remove("show");$("#cartDrawer").setAttribute('aria-hidden','true');}
function renderCartItems(){
  const body=$("#cartBody"),foot=$("#cartFoot");
  if(CART.length===0){body.innerHTML=`<div class="empty-cart"><div class="ec-ic">🛒</div><p>Your cart is empty.</p><button class="btn btn-ghost" style="margin-top:1rem" onclick="closeCart()">Continue Shopping</button></div>`;foot.style.display="none";return;}
  foot.style.display="block";
  body.innerHTML=CART.map(i=>{const m=cartLineMeta(i);if(!m)return'';const{p,v}=m;return `<div class="citem">
    <div class="ci-img"><img src="${primaryImg(p)}" alt="${escapeHtml(p.name)}"></div>
    <div class="ci-info"><h4>${p.name}</h4><div style="font-size:.75rem;color:var(--muted)">${v.label}</div><div class="ci-price">${fmt(v.price)}</div>
      <div class="qty"><button aria-label="Decrease quantity" onclick="changeQty(${p.id},'${v.sku}',-1)">−</button><span>${i.qty}</span><button aria-label="Increase quantity" onclick="changeQty(${p.id},'${v.sku}',1)">+</button></div>
      <br><a class="ci-remove" tabindex="0" role="button" onclick="removeItem(${p.id},'${v.sku}')">Remove</a></div></div>`;}).join('');
  const b=cartBreakdown();
  const offers=availablePublicCoupons();
  foot.innerHTML=`
    ${offers.length?`<div class="coupon-offers">
      <button type="button" class="co-toggle" onclick="toggleOffers()" aria-expanded="${_offersOpen?'true':'false'}">
        <span>Check offers<span class="co-count">${offers.length}</span></span>
        <span class="co-caret">▾</span>
      </button>
      ${_offersOpen?`<div class="co-chips">${offers.map(c=>`<button class="co-chip ${appliedCoupon===c.code?'active':''}" onclick="applyCouponCode('${c.code}')"><b>${escapeHtml(c.code)}</b><span>${escapeHtml(couponShort(c))}${c.minCart?` · min ${fmt(c.minCart)}`:''}</span></button>`).join('')}</div>`:''}
    </div>`:''}
    ${appliedCoupon
      ? `<div class="coupon-row applied"><span class="coupon-applied"><b>${escapeHtml(appliedCoupon)}</b> applied</span><button type="button" class="coupon-remove" onclick="removeCoupon()">✕ Remove</button></div>`
      : `<div class="coupon-row"><input id="couponInput" placeholder="Have a code?" aria-label="Coupon code"><button onclick="applyCoupon()">Apply</button></div>`}
    <div class="coupon-msg ${appliedCoupon?'ok':''}" id="couponMsg">${couponDescText()}</div>
    ${summaryRows(b)}
    <button class="btn btn-primary" onclick="openCheckout()">Proceed to Checkout</button>`;
}
/* Client QA r2: show public offers on top of the cart, tap to apply. Targeted /
   user-restricted coupons are never listed here. */
function couponShort(c){ return (c.type==='pct'||c.type==='percent')?(c.value+'% off'+(c.cap?` (max ${fmt(c.cap)})`:'')):('₹'+c.value+' off'); }
function availablePublicCoupons(){
  const out=[];
  Object.keys(COUPONS||{}).forEach(code=>{
    const c=COUPONS[code]; if(!c||c.active===false) return;
    if((c.scope||'all')!=='all') return;                         // hide product/user-targeted
    if(Array.isArray(c.userEmails)&&c.userEmails.length) return; // hide user-restricted
    if(c.expires){ const t=Date.parse(c.expires); if(!isNaN(t) && t<Date.now()) return; }
    out.push({code, desc:c.desc||'', type:c.type, value:c.value, minCart:c.minCart||0, cap:c.cap||0});
  });
  return out.slice(0,8);
}
function applyCouponCode(code){ const el=$("#couponInput"); if(el) el.value=code; applyCoupon(); }
/* Cart "Check offers": collapsed by default, expands to a 3-up grid of public codes. */
let _offersOpen=false;
function toggleOffers(){ _offersOpen=!_offersOpen; renderCartItems(); }
function removeCoupon(){ appliedCoupon=null; COUPON_INFO=null; renderCartItems(); toast('Coupon removed'); }

/* ---------- product modal (PDP) — variants, qty, gallery, content, cross-sell, reviews ---------- */
let pdpState={id:null,vsku:null,qty:1,img:0};
function openProduct(id){
  const p=PRODUCTS.find(x=>x.id===id);if(!p)return;
  track('product');
  const v=firstInStockVariant(p);
  pdpState={id,vsku:v?v.sku:null,qty:1,img:0};
  renderPDP();
  $("#modalRoot").classList.add("show");
  $("#modalRoot").setAttribute('aria-hidden','false');
  setTimeout(()=>{const x=$("#modalRoot .x");x&&x.focus();},30);
}
function selectVariant(sku){const p=PRODUCTS.find(x=>x.id===pdpState.id);const v=getVariant(p,sku);if(!v||v.stock===0)return;pdpState.vsku=sku;pdpState.qty=1;renderPDP();}
function pdpQty(d){const p=PRODUCTS.find(x=>x.id===pdpState.id);const v=getVariant(p,pdpState.vsku);const max=v?v.stock:1;pdpState.qty=Math.min(max,Math.max(1,pdpState.qty+d));const el=$("#pdpQtyVal");if(el)el.value=pdpState.qty;const a=$("#pdpDec");if(a)a.disabled=pdpState.qty<=1;const b=$("#pdpInc");if(b)b.disabled=pdpState.qty>=max;}
function pdpSetImg(i){pdpState.img=i;document.querySelectorAll('.pm-thumb').forEach((t,idx)=>t.classList.toggle('active',idx===i));const main=$("#pdpMainImg");if(main)main.src=galleryFor(PRODUCTS.find(x=>x.id===pdpState.id))[i];}
function pdpAddToCart(){addToCart(pdpState.id,pdpState.vsku,pdpState.qty);closeModal();openCart();}
function toggleAcc(el){el.parentElement.classList.toggle('open');const exp=el.getAttribute('aria-expanded')==='true';el.setAttribute('aria-expanded',!exp);}

function checkPincode(){
  const val=($("#pincodeInput")?.value||"").trim();
  const res=$("#pincodeResult");if(!res)return;
  if(!/^\d{6}$/.test(val)){res.className="pincode-result show no";res.textContent="Enter a valid 6-digit PIN code.";return;}
  // simulated serviceability (production: Shiprocket/Delhivery serviceability API)
  const serviceable = (parseInt(val[0])%9)!==0;
  if(serviceable){const days=2+(parseInt(val.slice(-1))%4);res.className="pincode-result show ok";res.textContent=`✓ Deliverable to ${val} · Estimated arrival in ${days}–${days+2} days. COD available.`;}
  else {res.className="pincode-result show no";res.textContent=`✗ Sorry, we don't currently deliver to ${val}. Email us to request coverage.`;}
}

/* Customer review photo upload (client feedback: attach an image to a review). */
let _homeReviewImg="", _pdpReviewImg="";
async function pickReviewImg(input, which){
  const f=input.files&&input.files[0]; if(!f) return;
  if(f.size>5*1024*1024){ toast("Image too large — max 5 MB"); input.value=""; return; }
  const dataUrl=await new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.readAsDataURL(f);});
  input.value="";
  const prev=$("#"+(which==='home'?'hrImgPrev':'reviewImgPrev'));
  if(prev) prev.innerHTML='<span style="font-size:.78rem;color:var(--muted)">Uploading…</span>';
  const r=BACKEND?await SDB.reviewImage(dataUrl):{ok:true,url:dataUrl};
  if(!r||!r.ok){ toast((r&&r.err)||"Photo upload failed"); if(prev)prev.innerHTML=''; return; }
  if(which==='home') _homeReviewImg=r.url; else _pdpReviewImg=r.url;
  if(prev) prev.innerHTML=`<div class="rev-img-prev"><img src="${r.url}" alt="review photo"><button type="button" onclick="clearReviewImg('${which}')" title="Remove photo">×</button></div>`;
}
function clearReviewImg(which){ if(which==='home')_homeReviewImg=""; else _pdpReviewImg=""; const prev=$("#"+(which==='home'?'hrImgPrev':'reviewImgPrev')); if(prev)prev.innerHTML=''; }
/* Simple full-screen viewer for a review photo. */
function openImgLightbox(src){
  if(!src) return;
  const el=document.createElement('div'); el.className='img-lightbox'; el.onclick=()=>el.remove();
  const img=document.createElement('img'); img.src=src; img.alt='';
  const btn=document.createElement('button'); btn.className='il-close'; btn.setAttribute('aria-label','Close'); btn.textContent='×';
  el.appendChild(img); el.appendChild(btn); document.body.appendChild(el);
}
async function submitReview(){
  // Client QA r2: reviews require login and admin approval before appearing.
  if(!requireLoginForReview()) return;
  const acct=currentShopper();
  const stars=pdpReviewStars; const text=($("#reviewText")?.value||"").trim(); const name=($("#reviewName")?.value||"").trim()||acct.name||"Verified Buyer";
  if(!stars){toast("Please pick a star rating");return;}
  if(text.length<5){toast("Please write a short review");return;}
  const id=pdpState.id;
  if(BACKEND){
    // save to the DB (held for approval) — only confirm if it actually succeeds
    const p0=PRODUCTS.find(x=>x.id===id);
    const r=await SDB.submitReview({kind:'product',product_sku:p0&&p0.sku,name:name,rating:stars,body:text,image_url:_pdpReviewImg||undefined});
    if(!reviewSaved(r)) return;
    _pdpReviewImg="";
  } else {
    if(!REVIEWS[id])REVIEWS[id]=[];
    REVIEWS[id].unshift({n:name,r:stars,t:text,v:false,pending:true,email:acct.email||"",img:_pdpReviewImg||""});   // offline moderation queue
    _pdpReviewImg=""; saveReviews();
  }
  pdpReviewStars=0;
  toast("Thanks! Your review was submitted and will appear once approved.");
  renderPDP();
}
/* Shared: did the backend actually accept the review? Surfaces the real error
   (e.g. not signed in) instead of a false "submitted" confirmation. */
function reviewSaved(r){
  if(r && r.ok) return true;
  const err=(r&&r.err)||"Could not submit your review. Please try again.";
  toast(err);
  if(/sign in/i.test(err)){ CURRENT_USER=null; updateAccountUI&&updateAccountUI(); accountTab='login'; renderAccountModal(); }
  return false;
}
/* Reviews are login-gated (client QA r2). Returns true if a shopper is signed in;
   otherwise prompts sign-in and returns false. */
function requireLoginForReview(){
  if(currentShopper()) return true;
  toast("Please sign in to write a review");
  accountTab='login'; _returnToCheckout=false; renderAccountModal();
  return false;
}
let pdpReviewStars=0;
function setReviewStars(n){pdpReviewStars=n;document.querySelectorAll('.star-input span').forEach((s,i)=>s.classList.toggle('on',i<n));}

/* ---------- Homepage reviews (no purchase required) ---------- */
/* Homepage "Avg. Rating" stat — computed from approved ratings, not hard-coded (client feedback).
   Averages all approved home testimonials + approved product reviews; keeps the default if none. */
function approvedRatings(){
  const rs=[];
  (HOME_REVIEWS||[]).forEach(r=>{ if(r&&!r.pending&&+r.r>0) rs.push(+r.r); });
  Object.keys(REVIEWS||{}).forEach(pid=>{ (REVIEWS[pid]||[]).forEach(r=>{ if(r&&!r.pending&&+r.r>0) rs.push(+r.r); }); });
  return rs;
}
function updateHeroRating(){
  const el=document.getElementById('heroAvgRating'); if(!el) return;
  const rs=approvedRatings(); if(!rs.length) return;
  const avg=Math.round((rs.reduce((a,b)=>a+b,0)/rs.length)*10)/10;
  el.dataset.count=String(avg); el.textContent=avg.toFixed(1)+'★';
}
function renderHomeReviews(){
  const box=$("#homeReviews"); if(!box)return;
  updateHeroRating();   // refresh the Avg. Rating stat from the loaded reviews
  // client feedback: cap the homepage testimonials (was unbounded → hard to scroll)
  box.innerHTML = HOME_REVIEWS.filter(r=>!r.pending).slice(0,10).map(r=>{
    const av=(r.n||"A").trim().charAt(0).toUpperCase()||"A";
    const place=r.l?`${escapeHtml(r.l)} · `:'';
    const badge=r.v?'Verified Buyer':'Customer';
    const filled='★'.repeat(r.r||5), empty='☆'.repeat(5-(r.r||5));
    const photo=r.img?`<img class="rev-photo" src="${escapeHtml(r.img)}" alt="Customer photo" loading="lazy" onclick="openImgLightbox('${escapeHtml(r.img)}')">`:'';
    return `<div class="test${r.user?' user-review':''}"><div class="stars">${filled}${empty}</div><p>"${escapeHtml(r.t)}"</p>${photo}<div class="who"><div class="av">${escapeHtml(av)}</div><div><b>${escapeHtml(r.n||'Anonymous')}</b><br><small>${place}${badge}</small></div></div></div>`;
  }).join('');
  // re-arm reveal for freshly injected nodes
  box.classList.add('is-visible');
}
let homeReviewStars=0;
function setHomeStars(n){homeReviewStars=n;document.querySelectorAll('#hrStars span').forEach((s,i)=>s.classList.toggle('on',i<n));}
function toggleHomeReviewForm(){
  const f=$("#homeReviewForm"); if(!f)return;
  if(!f.classList.contains('open') && !requireLoginForReview()) return; // login-gated
  const open=f.classList.toggle('open');
  const t=$("#homeReviewToggle"); if(t)t.textContent=open?'✕ Close':'✍ Write a Review';
  if(open)setTimeout(()=>$("#hrText")?.focus(),120);
}
async function submitHomeReview(){
  if(!requireLoginForReview()) return;               // login-gated (client QA r2)
  const acct=currentShopper();
  const text=($("#hrText")?.value||"").trim();
  const name=($("#hrName")?.value||"").trim()||acct.name||"Anonymous";
  const place=($("#hrPlace")?.value||"").trim();
  if(!homeReviewStars){toast("Please pick a star rating");return;}
  if(text.length<5){toast("Please write a short review");return;}
  if(BACKEND){
    // save to the DB (held for approval) — only confirm if it actually succeeds
    const r=await SDB.submitReview({kind:'home',name:name,location:place,rating:homeReviewStars,body:text,image_url:_homeReviewImg||undefined});
    if(!reviewSaved(r)) return;
  } else {
    // offline moderation queue
    HOME_REVIEWS.unshift({t:text,n:name,l:place,r:homeReviewStars,v:false,user:true,pending:true,email:acct.email||"",img:_homeReviewImg||""});
    saveHomeReviews();
  }
  homeReviewStars=0; _homeReviewImg="";
  const f=$("#homeReviewForm"); if(f)f.classList.remove('open');
  const tog=$("#homeReviewToggle"); if(tog)tog.textContent='✍ Write a Review';
  const hp=$("#hrImgPrev"); if(hp)hp.innerHTML='';
  ["#hrText","#hrName","#hrPlace"].forEach(s=>{const el=$(s);if(el)el.value='';});
  document.querySelectorAll('#hrStars span').forEach(s=>s.classList.remove('on'));
  renderHomeReviews();
  toast("Thanks! Your review was submitted and will appear once approved.");
}

function renderPDP(){
  const p=PRODUCTS.find(x=>x.id===pdpState.id);if(!p)return;
  const v=getVariant(p,pdpState.vsku)||{};
  const off=v.mrp?Math.round((1-v.price/v.mrp)*100):0;
  const gallery=galleryFor(p);
  const related=PRODUCTS.filter(x=>x.id!==p.id&&x.cat===p.cat&&x.stock>0&&!x.draft).slice(0,3);
  const cross = related.length<3 ? related.concat(PRODUCTS.filter(x=>x.id!==p.id&&x.cat!==p.cat&&x.stock>0&&!x.draft).slice(0,3-related.length)) : related;
  const rv=(REVIEWS[p.id]||[]).filter(r=>!r.pending);   // hide unapproved (client QA r2)
  const avg = rv.length? (rv.reduce((s,r)=>s+r.r,0)/rv.length).toFixed(1) : p.rating;
  const c=p.content||{};

  $("#modalRoot").innerHTML=`<div class="modal-bg" onclick="closeModal()"></div>
   <div class="modal-card wide" role="dialog" aria-modal="true" aria-label="${escapeHtml(p.name)} details">
     <div class="modal-head">
       <nav class="breadcrumbs" aria-label="Breadcrumb" style="margin:0">
         <a href="#/" onclick="closeModal();goHomePage(event)">Home</a><span class="sep">›</span>
         <a href="#/shop" onclick="closeModal();return goShop('${p.cat}',event)">${p.cat}</a><span class="sep">›</span>
         <span aria-current="page">${escapeHtml(p.name)}</span>
       </nav>
       <button class="x" aria-label="Close" onclick="closeModal()">×</button>
     </div>
     <div class="modal-body"><div class="pm-grid">
       <div class="pm-gallery">
         <div class="pm-main-img"><img id="pdpMainImg" src="${gallery[pdpState.img]}" alt="${escapeHtml(p.name)} view ${pdpState.img+1}"></div>
         <div class="pm-thumbs">${gallery.map((g,i)=>`<button class="pm-thumb ${i===pdpState.img?'active':''}" aria-label="View image ${i+1}" onclick="pdpSetImg(${i})"><img src="${g}" alt=""></button>`).join('')}</div>
       </div>
       <div class="pm-detail">
         <div class="stars" aria-label="Rated ${avg} out of 5">★★★★★ <span style="color:var(--muted)">${avg} · ${rv.length||p.reviews} reviews</span></div>
         <h2>${p.name}</h2>
         <div class="price"><b>${fmt(v.price)}</b><s>${fmt(v.mrp)}</s>${off?`<span class="off">${off}% off</span>`:''}</div>
         <div style="font-size:.74rem;color:var(--muted);margin:-.2rem 0 .4rem">MRP inclusive of all taxes${p.gst>0?` · incl. ${p.gst}% GST`:' · GST exempt'}</div>
         <div class="stockline ${stockState(v.stock,lowThreshold(p))}"><span class="sd"></span>${stockLabel(v.stock,lowThreshold(p))} · SKU ${v.sku}</div>
         <p class="pm-desc">${p.desc}</p>

         ${p.variants&&p.variants.length>1?`<div><label style="font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">Size / Weight</label>
           <div class="variants" role="group" aria-label="Select size">
             ${p.variants.map(vr=>`<button class="variant ${vr.sku===pdpState.vsku?'active':''} ${vr.stock===0?'oos':''}" ${vr.stock===0?'disabled aria-disabled="true"':''} onclick="selectVariant('${vr.sku}')">${vr.label}<small>${fmt(vr.price)}</small></button>`).join('')}
           </div></div>`:''}

         <div style="display:flex;gap:.8rem;align-items:center;margin:1rem 0;flex-wrap:wrap">
           <label class="sr-only" for="pdpQtyVal">Quantity</label>
           <div class="qty-stepper">
             <button id="pdpDec" aria-label="Decrease quantity" ${pdpState.qty<=1?'disabled':''} onclick="pdpQty(-1)">−</button>
             <input id="pdpQtyVal" type="text" value="${pdpState.qty}" readonly aria-label="Quantity">
             <button id="pdpInc" aria-label="Increase quantity" ${pdpState.qty>=(v.stock||1)?'disabled':''} onclick="pdpQty(1)">+</button>
           </div>
           <button class="btn ${v.stock===0?'btn-notify':'btn-primary'}" style="flex:1;justify-content:center;min-width:160px" onclick="${v.stock===0?`notifyMe(${p.id},event)`:'pdpAddToCart()'}">${v.stock===0?'🔔 Notify Me':'Add to Cart →'}</button>
         </div>
         ${(()=>{const amz=((v&&v.amazonUrl)||'').trim()||(p.amazonUrl||'').trim();   // variation link wins, product link is the fallback
           return amz?`<a class="btn btn-amazon" href="${escapeHtml(amz)}" target="_blank" rel="noopener" style="width:100%;justify-content:center;margin:-.3rem 0 .4rem">Buy on Amazon ↗${(p.variants&&p.variants.length>1)?` · ${escapeHtml(v.label)}`:''}</a>`:'';})()}

         <div class="pincode-check">
           <label for="pincodeInput">Check delivery to your area</label>
           <div class="pincode-row"><input id="pincodeInput" inputmode="numeric" maxlength="6" placeholder="Enter 6-digit PIN code" aria-label="PIN code"><button onclick="checkPincode()">Check</button></div>
           <div class="pincode-result" id="pincodeResult" aria-live="polite"></div>
         </div>

         <ul class="pm-feats">${p.feats.map(f=>`<li>${f}</li>`).join('')}</ul>

         <!-- Expandable detail sections -->
         <div class="pm-sections">
           <div class="pm-acc open"><button class="pm-acc-head" aria-expanded="true" onclick="toggleAcc(this)">Specifications <span class="chev">⌄</span></button>
             <div class="pm-acc-body"><dl class="pm-spec">
               <dt>Net weight</dt><dd>${v.label||c.netWeight}</dd>
               <dt>Shelf life</dt><dd>${c.shelfLife||'—'}</dd>
               <dt>GST</dt><dd>${p.gst}% (included)</dd>
               <dt>HSN code</dt><dd>${p.hsn||'—'}</dd>
               <dt>SKU</dt><dd>${v.sku}</dd>
             </dl></div></div>
           <div class="pm-acc"><button class="pm-acc-head" aria-expanded="false" onclick="toggleAcc(this)">Ingredients & Origin <span class="chev">⌄</span></button>
             <div class="pm-acc-body"><p><b>Ingredients:</b> ${c.ingredients||'—'}</p><p style="margin-top:.4rem"><b>Origin:</b> ${c.origin||'—'}</p></div></div>
           <div class="pm-acc"><button class="pm-acc-head" aria-expanded="false" onclick="toggleAcc(this)">How to use <span class="chev">⌄</span></button>
             <div class="pm-acc-body">${c.usage||'—'}</div></div>
           <div class="pm-acc"><button class="pm-acc-head" aria-expanded="false" onclick="toggleAcc(this)">Certifications & Lab Report <span class="chev">⌄</span></button>
             <div class="pm-acc-body">${c.certifications||'—'}<br>${c.labUrl?`<a href="${escapeHtml(c.labUrl)}" target="_blank" rel="noopener" style="color:var(--gold);text-decoration:underline">View batch lab report ↗</a>`:`<span style="color:var(--muted);font-size:.84rem">Lab report link not published yet.</span>`}</div></div>
           <div class="pm-acc"><button class="pm-acc-head" aria-expanded="false" onclick="toggleAcc(this)">Shipping & Returns <span class="chev">⌄</span></button>
             <div class="pm-acc-body">Free shipping over ₹999. Dispatched in 24–48h. Returns accepted within 7 days for unopened items; perishables are quality-guaranteed on arrival. Track via your account.</div></div>
           ${(p.faqs||[]).length?`<div class="pm-acc"><button class="pm-acc-head" aria-expanded="false" onclick="toggleAcc(this)">FAQs <span class="chev">⌄</span></button>
             <div class="pm-acc-body">${p.faqs.map(f=>`<p style="margin-bottom:.6rem"><b>${f.q}</b><br>${f.a}</p>`).join('')}</div></div>`:''}
         </div>

         <!-- Cross-sell -->
         <div class="crosssell">
           <h4>Frequently bought together</h4>
           <div class="cs-row">${cross.map(x=>`<div class="cs-card" onclick="openProduct(${x.id})" role="button" tabindex="0" onkeydown="if(event.key==='Enter')openProduct(${x.id})">
             <img src="${primaryImg(x)}" alt="${escapeHtml(x.name)}"><b>${x.name}</b><span>${fmt(x.price)}</span></div>`).join('')}</div>
         </div>

         <!-- Reviews engine -->
         <div class="reviews-block">
           <div class="rb-summary"><div class="rb-avg">${avg}</div><div><div class="stars">★★★★★</div><small style="color:var(--muted)">${rv.length||p.reviews} reviews</small></div></div>
           ${rv.map(r=>`<div class="review-item"><div class="rh"><b>${escapeHtml(r.n)}</b>${r.v?'<span class="verified">✓ Verified Buyer</span>':''}</div><div class="stars" style="font-size:.8rem">${'★'.repeat(r.r)}${'☆'.repeat(5-r.r)}</div><p>${escapeHtml(r.t)}</p>${r.img?`<img class="rev-photo" src="${escapeHtml(r.img)}" alt="Customer photo" loading="lazy" onclick="openImgLightbox('${escapeHtml(r.img)}')">`:''}</div>`).join('')||'<p style="color:var(--muted);font-size:.85rem">Be the first to review this product.</p>'}
           <div style="margin-top:1rem;border-top:1px solid var(--line);padding-top:1rem">
             <h4 style="font-size:.95rem;margin-bottom:.6rem">Write a review</h4>
             <div class="star-input" role="radiogroup" aria-label="Your rating">${[1,2,3,4,5].map(n=>`<span role="radio" aria-label="${n} star" tabindex="0" onclick="setReviewStars(${n})" onkeydown="if(event.key==='Enter')setReviewStars(${n})">★</span>`).join('')}</div>
             <div class="field" style="margin-top:.6rem"><input id="reviewName" placeholder="Your name" aria-label="Your name"></div>
             <div class="field"><textarea id="reviewText" rows="2" placeholder="Share your experience…" aria-label="Your review"></textarea></div>
             <div id="reviewImgPrev"></div>
             <label class="rev-img-btn">📷 Add a photo (optional)<input type="file" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="pickReviewImg(this,'pdp')"></label>
             <button class="btn btn-gold" onclick="submitReview()">Submit Review</button>
           </div>
         </div>
       </div></div></div></div>`;
  pdpReviewStars=0;
  injectFaqSchema(p);
}

/* ---------- checkout (validation, GST, coupon) ---------- */
function openCheckout(){
  if(CART.length===0)return;
  closeCart();
  const b=cartBreakdown();const total=b.total;
  // client #4: COD only offered when the admin has enabled it (and within any COD cap)
  const codOk = SETTINGS.codEnabled!==false && (!SETTINGS.codMaxOrder || total<=SETTINGS.codMaxOrder);
  if(payMethod==='cod' && !codOk) payMethod='online';
  $("#modalRoot").innerHTML=`<div class="modal-bg" onclick="closeModal()"></div>
   <div class="modal-card" role="dialog" aria-modal="true" aria-label="Checkout"><div class="modal-head"><h3>Checkout</h3><button class="x" aria-label="Close" onclick="closeModal()">×</button></div>
   <div class="modal-body">
     ${currentShopper()?'':`<div class="co-auth" id="coAuth">
       <div class="co-auth-txt"><b>Have an account?</b> Sign in for faster checkout with your saved addresses.</div>
       <div class="co-auth-btns">
         <button type="button" class="btn-sm primary" onclick="checkoutAuth('login')">Sign in</button>
         <button type="button" class="btn-sm" onclick="checkoutAuth('register')">Create account</button>
         <button type="button" class="btn-sm co-guest" onclick="checkoutGuest()">Continue as guest</button>
       </div>
     </div>`}
     <div class="simnote">🔒 Payments are processed securely via Razorpay — pay by UPI, Card, Netbanking or Wallet in the next step.</div>
     <div id="savedAddrPicker"></div>
     <form id="checkoutForm" novalidate onsubmit="return false">
       <div class="field row2"><div><label for="coFn">First Name *</label><input id="coFn" required placeholder="Ananya"><div class="err-msg">Please enter your first name.</div></div><div><label for="coLn">Last Name *</label><input id="coLn" required placeholder="Rao"><div class="err-msg">Please enter your last name.</div></div></div>
       <div class="field"><label for="coEmail">Email *</label><input id="coEmail" type="email" required placeholder="you@email.com"><div class="err-msg">Enter a valid email address.</div></div>
       <div class="field"><label for="coPhone">Phone *</label><input id="coPhone" type="tel" inputmode="numeric" required placeholder="10-digit mobile"><div class="err-msg">Enter a valid 10-digit Indian mobile number.</div></div>
       <div class="field"><label for="coAddr">Address *</label><textarea id="coAddr" rows="2" required placeholder="House, street, area"></textarea><div class="err-msg">Please enter your delivery address.</div></div>
       <div class="field row2"><div><label for="coPin">PIN Code *</label><input id="coPin" inputmode="numeric" maxlength="6" required placeholder="560001" oninput="onPinInput()"><div class="err-msg">Enter a valid 6-digit PIN code.</div><div id="pinMsg" class="pin-msg" aria-live="polite"></div></div><div><label for="coCity">City *</label><input id="coCity" required placeholder="Bengaluru"><div class="err-msg">Please enter your city.</div></div></div>
       <div class="field"><label for="coState">State *</label><input id="coState" required placeholder="Karnataka" autocomplete="address-level1"><div class="err-msg">Please enter your state.</div></div>
       <label style="font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">Payment Method</label>
       <div class="pay-methods" role="radiogroup" aria-label="Payment method">
         <div class="pm active" data-pm="online" role="radio" aria-checked="true" tabindex="0" onclick="selPay('online',this)" onkeydown="if(event.key==='Enter')selPay('online',this)">Pay online via Razorpay</div>
         ${codOk?`<div class="pm" data-pm="cod" role="radio" aria-checked="false" tabindex="0" onclick="selPay('cod',this)" onkeydown="if(event.key==='Enter')selPay('cod',this)">Cash on Delivery</div>`:''}
       </div>
       <p style="font-size:.74rem;color:var(--muted);margin:.1rem 0 1rem">You'll choose UPI, Card, Netbanking or Wallet securely inside the Razorpay window.</p>
       <div class="drawer-foot" style="border:1px solid var(--line);border-radius:12px;padding:1.2rem;margin-bottom:1.2rem;background:var(--cream-deep)">
         ${summaryRows(b)}
       </div>
       <div style="display:flex;gap:.6rem;align-items:center;font-size:.78rem;color:var(--muted);margin-bottom:1rem;flex-wrap:wrap">
         <span>🔒 Secure checkout</span><span>· 7-day returns</span><span>· Support: support@suddhalaya.com</span>
       </div>
       <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="placeOrder(${total})">Place Order · ${fmt(total)}</button>
     </form>
   </div></div>`;
  $("#modalRoot").classList.add("show");
  // Prefill from the signed-in account (name/email + most recent saved address)
  const acct=currentShopper();
  if(acct){
    const parts=(acct.name||"").trim().split(/\s+/);
    const set=(id,v)=>{const el=$("#"+id);if(el&&!el.value&&v)el.value=v;};
    set("coFn",parts[0]||""); set("coLn",parts.slice(1).join(" "));
    set("coEmail",acct.email);
    const a=savedAddresses(acct.email)[0];
    if(a){set("coPhone",a.phone);set("coAddr",a.addr);set("coCity",a.city);set("coState",a.state);set("coPin",a.pin);}
  }
  renderSavedAddrPicker();
  setTimeout(()=>{const x=$("#coFn");x&&x.focus();},30);
}
let _checkoutAddrs=[];
let _returnToCheckout=false;
/* Client QA r2: checkout should offer Sign in / Create account / Continue as guest. */
function checkoutAuth(tab){
  _returnToCheckout=true;
  accountTab=(tab==='register')?'register':'login';
  renderAccountModal();
}
function checkoutGuest(){
  const el=$("#coAuth"); if(el) el.remove();
  const x=$("#coFn"); if(x) x.focus();
}
/* Compact one-line summary of an address for the dropdown. */
function addrSummary(a){
  const who=(a.name||'Address').trim();
  const rest=[a.addr, a.city, a.pin].map(x=>(x||'').toString().trim()).filter(Boolean).join(', ');
  let s = rest ? `${who} — ${rest}` : who;
  return s.length>60 ? s.slice(0,58)+'…' : s;
}
/* Client request: show saved addresses as a compact dropdown (was a stack of cards
   that made the checkout page very long). Picking one fills the form below. */
function renderSavedAddrPicker(){
  const box=$("#savedAddrPicker"); if(!box) return;
  const acct=currentShopper();
  _checkoutAddrs = acct ? savedAddresses(acct.email) : [];
  if(!_checkoutAddrs.length){ box.innerHTML=''; return; }
  box.innerHTML=`<div class="field co-saved">
    <label for="savedAddrSel">Deliver to a saved address</label>
    <select id="savedAddrSel" class="co-select" onchange="onSavedAddrSelect(this.value)">
      <option value="">➕ Use a new address…</option>
      ${_checkoutAddrs.map((a,i)=>`<option value="${i}">${escapeHtml(addrSummary(a))}</option>`).join('')}
    </select>
  </div>`;
}
function onSavedAddrSelect(v){ if(v==='') return; useSavedAddress(+v); }
function useSavedAddress(i){
  const a=_checkoutAddrs[i]; if(!a) return;
  const set=(id,v)=>{const el=$("#"+id);if(el){el.value=v||'';const f=el.closest('.field');if(f&&(v||'').toString().trim())f.classList.remove('invalid');}};
  const parts=(a.name||'').trim().split(/\s+/);
  set('coFn',parts[0]||''); set('coLn',parts.slice(1).join(' '));
  set('coPhone',a.phone); set('coAddr',a.addr); set('coCity',a.city); set('coState',a.state); set('coPin',a.pin);
  const sel=$("#savedAddrSel"); if(sel && String(sel.value)!==String(i)) sel.value=String(i);
  const pm=$("#pinMsg"); if(pm){pm.className='pin-msg';pm.textContent='';}
  toast('Address filled in — review & place your order');
}
function selPay(m,el){payMethod=m;document.querySelectorAll('.pm').forEach(x=>{x.classList.remove('active');x.setAttribute('aria-checked','false');});el.classList.add('active');el.setAttribute('aria-checked','true');}

function validateCheckout(){
  let ok=true;
  const set=(id,valid)=>{const f=document.getElementById(id).closest('.field');if(valid)f.classList.remove('invalid');else{f.classList.add('invalid');ok=false;}};
  const val=id=>document.getElementById(id).value.trim();
  set('coFn',val('coFn').length>0);
  set('coLn',val('coLn').length>0);
  set('coEmail',/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('coEmail')));
  set('coPhone',/^[6-9]\d{9}$/.test(val('coPhone').replace(/\D/g,'').slice(-10)));
  set('coAddr',val('coAddr').length>4);
  set('coCity',val('coCity').length>0);
  set('coState',val('coState').length>0);
  set('coPin',/^\d{6}$/.test(val('coPin')));
  return ok;
}
/* Client QA r2: enter a 6-digit PIN → auto-fill City + State (India Post public API). */
async function onPinInput(){
  const el=$("#coPin"); if(!el) return;
  const pin=(el.value||'').replace(/\D/g,'').slice(0,6); el.value=pin;
  const msg=$("#pinMsg");
  if(pin.length!==6){ if(msg){msg.className='pin-msg';msg.textContent='';} return; }
  if(msg){msg.className='pin-msg loading';msg.textContent='Detecting city & state…';}
  try{
    const r=await fetch('https://api.postalpincode.in/pincode/'+pin,{cache:'force-cache'});
    const j=await r.json();
    const rec=Array.isArray(j)?j[0]:null;
    if(rec&&rec.Status==='Success'&&rec.PostOffice&&rec.PostOffice.length){
      const po=rec.PostOffice[0];
      const city=po.District||po.Division||po.Block||'';
      const state=po.State||'';
      const cityEl=$("#coCity"),stEl=$("#coState");
      if(cityEl&&city)cityEl.value=city;
      if(stEl&&state)stEl.value=state;
      [cityEl,stEl].forEach(f=>{const fl=f&&f.closest('.field');if(fl)fl.classList.remove('invalid');});
      if(msg){msg.className='pin-msg ok';msg.textContent='✓ '+city+', '+state;}
    } else { if(msg){msg.className='pin-msg no';msg.textContent='PIN not recognised — type city & state manually.';} }
  }catch(e){ if(msg){msg.className='pin-msg no';msg.textContent='Offline — type city & state manually.';} }
}
function showOrderConfirmed(oid, paid, invoice){
  $("#modalRoot").innerHTML=`<div class="modal-bg" onclick="closeModal()"></div>
   <div class="modal-card" role="dialog" aria-modal="true"><div class="modal-body success-check">
     <div class="sc-ic">✓</div><h3 style="font-size:1.5rem">Order Confirmed!</h3>
     <p style="color:var(--muted);margin:.6rem 0 1.2rem">Your order <b>${oid}</b> has been placed${paid?(invoice?` and ${invoice} issued`:` and paid`):` (COD)`}. A confirmation email is on its way.<br><br><span style="font-size:.8rem">You can view this order and download your invoice anytime from <b>Your Account</b>. We'll email you again as soon as it ships.</span></p>
     <button class="btn btn-primary" onclick="closeModal()">Continue Shopping</button>
   </div></div>`;
}
/* Shared completion for a successful backend order (built-in flow OR Razorpay). */
function finalizeBackendOrder(r, ctx){
  ctx.valid.forEach(({i,m})=>{ if(m.v){deductVariantOffline(m.v,i.qty);} syncProductFromVariants(m.p); });
  CART=[];appliedCoupon=null;saveCart();updateCartUI();renderProducts();track('order');
  SDB.myOrders().then(res=>{ if(res&&res.orders) MY_ORDERS=res.orders; });
  if(ctx.email) rememberAddress(ctx.email,{name:ctx.name,addr:ctx.ship.line,city:ctx.ship.city,state:ctx.ship.state,pin:ctx.ship.pin,phone:ctx.phone});
  showOrderConfirmed(r.order_no, r.payment_status==='paid', r.invoice);
}
/* Client QA r2 / Razorpay: load the checkout SDK on demand. */
let _rzpLoading=null;
function loadRazorpaySdk(){
  if(window.Razorpay) return Promise.resolve(true);
  if(_rzpLoading) return _rzpLoading;
  _rzpLoading=new Promise(res=>{
    const s=document.createElement('script'); s.src='https://checkout.razorpay.com/v1/checkout.js';
    s.onload=()=>res(true); s.onerror=()=>res(false); document.head.appendChild(s);
  });
  return _rzpLoading;
}
/* Returns 'unconfigured' (no keys → caller falls back), 'error', or 'opened'. */
async function startRazorpayCheckout(payload, ctx){
  const reset=()=>{ if(ctx.btn){ctx.btn.disabled=false;ctx.btn.textContent="Place Order · "+fmt(ctx.total);} };
  let ord;
  try{
    ord=await (await fetch('/api/razorpay/order',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({amount:ctx.total, email:payload.customer.email})})).json();
  }catch(e){ ord=null; }
  if(!ord || ord.configured===false) return 'unconfigured';
  if(!ord.ok){ toast(ord.err||"Could not start payment"); reset(); return 'error'; }
  const loaded=await loadRazorpaySdk();
  if(!loaded || !window.Razorpay){ toast("Payment gateway failed to load"); reset(); return 'error'; }
  const rzp=new window.Razorpay({
    key: ord.key_id, order_id: ord.order_id, amount: ord.amount, currency: ord.currency||'INR',
    name: (SETTINGS.storeName||'Suddhalaya'), description: 'Order payment',
    prefill:{ name:payload.customer.name, email:payload.customer.email, contact:payload.customer.phone },
    theme:{ color:'#1f3520' },
    handler: async function(resp){
      if(ctx.btn){ctx.btn.disabled=true;ctx.btn.textContent="Verifying payment…";}
      let v;
      try{
        v=await (await fetch('/api/razorpay/verify',{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify(Object.assign({}, resp, payload))})).json();
      }catch(e){ v=null; }
      if(!v || !v.ok){ toast((v&&v.err)||"Payment could not be verified"); reset(); return; }
      finalizeBackendOrder(v, ctx);
    },
    modal:{ ondismiss:function(){ reset(); } }
  });
  rzp.on('payment.failed', function(){ toast("Payment failed — please try again"); reset(); });
  rzp.open();
  return 'opened';
}
async function placeOrder(total){
  if(!validateCheckout()){toast("Please correct the highlighted fields");const bad=document.querySelector('.field.invalid input,.field.invalid textarea');bad&&bad.focus();return;}
  const _fn=$("#coFn")?.value||"Guest", _ln=$("#coLn")?.value||"";
  const _email=$("#coEmail")?.value||"", _phone=($("#coPhone")?.value||"").replace(/\D/g,'').slice(-10);
  const _name=(_fn+" "+_ln).trim();
  const _ship={name:_name,line:$("#coAddr")?.value||"",city:$("#coCity")?.value||"",state:$("#coState")?.value||"",pin:$("#coPin")?.value||""};

  // resolve cart to valid, in-catalog lines (guards against stale carts whose product
  // ids/SKUs no longer exist — otherwise p is undefined and reading p.variants throws)
  const valid=CART.map(i=>({i, m:cartLineMeta(i)})).filter(x=>x.m && x.m.v && x.m.v.sku);
  if(!valid.length){ toast("Your cart has no available items."); pruneCart(); return; }

  if(BACKEND){
    const items=valid.map(x=>({sku:x.m.v.sku, qty:x.i.qty}));
    const btn=$("#checkoutForm .btn-primary"); if(btn){btn.disabled=true;btn.textContent="Placing order…";}
    const payload={items, customer:{name:_name,email:_email,phone:_phone}, ship:_ship, payment_method:payMethod, coupon:appliedCoupon||null};
    const ctx={valid, ship:_ship, email:_email, name:_name, phone:_phone, total, btn};
    // Prepaid (UPI/Card) goes through real Razorpay; COD and un-configured stores use the built-in flow.
    if(payMethod!=='cod'){
      const outcome=await startRazorpayCheckout(payload, ctx);
      if(outcome!=='unconfigured') return;   // 'opened' finishes in its own handler; 'error' already surfaced
      if(btn){btn.textContent="Placing order…";}   // no Razorpay keys -> fall back to built-in flow
    }
    const r=await SDB.placeOrder(payload);
    if(!r||!r.ok){ toast((r&&r.err)||"Could not place order"); if(btn){btn.disabled=false;btn.textContent="Place Order · "+fmt(total);} return; }
    finalizeBackendOrder(r, ctx);
    return;
  }

  // ---- offline / localStorage path ----
  // Capture shipping from the same single source of truth BEFORE the cart is cleared (client #3)
  const shipTotal=cartBreakdown().ship;
  // Build full line items from the valid cart lines BEFORE clearing it (audit P0 #2)
  const lines=valid.map(({i,m})=>{const p=m.p,v=m.v;
    return {sku:v.sku||p.sku,name:p.name,variant:v.label||"Standard",qty:i.qty,price:v.price||p.price,gst:p.gst||0};});
  // Deduct variant stock (client-side in the offline prototype)
  valid.forEach(({i,m})=>{ if(m.v){deductVariantOffline(m.v,i.qty);} syncProductFromVariants(m.p); });
  const fn=$("#coFn")?.value||"Guest", ln=$("#coLn")?.value||"";
  const email=$("#coEmail")?.value||"", phone=($("#coPhone")?.value||"").replace(/\D/g,'').slice(-10);
  const custName=(fn+" "+ln).trim();
  // Link or create a customer record (audit P1 #4)
  let cust=CUSTOMERS.find(c=>c.email===email);
  if(!cust&&email){cust={id:Date.now(),name:custName,email,phone,city:$("#coCity")?.value||"",since:nowStamp().split(' ').slice(0,3).join(' '),tags:[]};CUSTOMERS.unshift(cust);}
  const oid="#SDL"+(2042+ORDERS.length);
  const paid = payMethod!=="cod";
  const order={
    id:oid, customerId:cust?cust.id:null, customer:custName, email, phone,
    lines,
    ship:{name:custName,line:$("#coAddr")?.value||"",city:$("#coCity")?.value||"",state:$("#coState")?.value||"",pin:$("#coPin")?.value||""},
    payment:{method:payMethod,status:paid?"paid":"pending",txnId:paid?("pay_"+Math.random().toString(36).slice(2,12)):"",gateway:paid?"Razorpay":"COD",capturedAt:paid?nowStamp():""},
    shipTotal:shipTotal,
    status:paid?"processing":"payment-pending", date:nowStamp().split(' ').slice(0,3).join(' '),
    timeline:[{t:nowStamp(),actor:"customer",note:"Order placed"+(paid?"":" (COD)")}]
  };
  if(paid){const inv=nextInvoiceNo();order.payment.invoice=inv;order.timeline.push({t:nowStamp(),actor:"system",note:"Payment captured ("+order.payment.gateway+")"});order.timeline.push({t:nowStamp(),actor:"system",note:"GST invoice "+inv+" generated"});}
  order.items=orderItemsCount(order); order.total=orderTotal(order);
  ORDERS.unshift(order);
  // If the shopper is signed in, save this delivery address to their account
  if(email){
    rememberAddress(email,{name:custName,addr:$("#coAddr")?.value||"",city:$("#coCity")?.value||"",state:$("#coState")?.value||"",pin:$("#coPin")?.value||"",phone});
  }
  notify(order.email,"Order confirmation",`Your order ${oid} is confirmed.`);
  track('order');
  logAudit("order.create",oid,`${order.items} items · ${fmt(order.total)} · ${order.payment.method.toUpperCase()}`);
  persistAll();
  CART=[];appliedCoupon=null;saveCart();updateCartUI();renderProducts();
  showOrderConfirmed(oid, paid, order.payment.invoice);
}
function orderSubtotalLines(lines){return (lines||[]).reduce((s,l)=>s+l.price*l.qty,0);}
/* notification stub — logs an event (audit P1 #1). In production this calls a transactional provider. */
let NOTIFY_LOG = dbLoad("notifylog", []);
function notify(to,subject,body){
  if(!to) return;
  NOTIFY_LOG.unshift({t:nowStamp(),to,subject,body,channel:SETTINGS.notifyEmail?"email":"—"});
  if(NOTIFY_LOG.length>200) NOTIFY_LOG=NOTIFY_LOG.slice(0,200);
  dbSave("notifylog",NOTIFY_LOG);
}
function closeModal(){_returnToCheckout=false;$("#modalRoot").classList.remove("show");$("#modalRoot").setAttribute('aria-hidden','true');}

/* ---------- storefront search ---------- */
let searchKbdIdx=-1;
function onSearch(q){
  q=(q||"").trim().toLowerCase();
  const box=$("#searchResults");if(!box)return;
  if(!q){box.classList.remove("show");box.innerHTML="";return;}
  const matches=PRODUCTS.filter(p=>!p.draft && (p.name.toLowerCase().includes(q)||p.cat.toLowerCase().includes(q)||(p.desc||'').toLowerCase().includes(q))).slice(0,6);
  searchKbdIdx=-1;
  if(!matches.length){box.innerHTML=`<div class="sr-empty">No products match “${escapeHtml(q)}”.</div>`;box.classList.add("show");return;}
  box.innerHTML=matches.map(p=>`<div class="sr-item" role="option" tabindex="-1" onmousedown="openSearchResult(${p.id})">
    <img src="${primaryImg(p)}" alt=""><div><b>${escapeHtml(p.name)}</b><br><small>${p.cat} · ${fmt(p.price)}</small></div></div>`).join('');
  box.classList.add("show");
}
function openSearchResult(id){closeSearch();const inp=$("#storeSearch");if(inp)inp.value="";closeMobileSearch&&closeMobileSearch();openProduct(id);}
function closeSearch(){const box=$("#searchResults");if(box)box.classList.remove("show");}
/* Mobile search: physically relocate the search bar into a full-width header row
   (#msearch) so it pushes page content DOWN instead of overlaying/hiding it, and
   keep the toggle icon in sync (⌕ ↔ ✕). On close it moves back into the icon row. */
function mobileSearchOpen(){ const h=document.getElementById('msearch'); const w=document.querySelector('.search-wrap'); return !!(h&&w&&h.contains(w)); }
function toggleMobileSearch(e){
  if(e)e.preventDefault();
  if(mobileSearchOpen()) closeMobileSearch();
  else {
    const holder=document.getElementById('msearch'); const wrap=document.querySelector('.search-wrap'); if(!holder||!wrap) return;
    holder.appendChild(wrap); holder.classList.add('open');
    const btn=document.querySelector('.search-toggle'); if(btn){ btn.classList.add('active'); btn.setAttribute('aria-expanded','true'); btn.textContent='✕'; }
    const inp=$("#storeSearch"); if(inp) setTimeout(()=>inp.focus(),60);
    closeMobileNav();
  }
}
function closeMobileSearch(){
  const holder=document.getElementById('msearch'); const wrap=holder&&holder.querySelector('.search-wrap');
  if(wrap){ const nav=document.querySelector('.nav-icons'); const wish=document.getElementById('wishBtn'); if(nav) nav.insertBefore(wrap, wish||null); }
  if(holder) holder.classList.remove('open');
  const btn=document.querySelector('.search-toggle'); if(btn){ btn.classList.remove('active'); btn.setAttribute('aria-expanded','false'); btn.textContent='⌕'; }
  closeSearch();
}
/* mobile nav panel — the burger used to scrollIntoView() the desktop .menu,
   which is display:none under 980px, so it did nothing on phones. */
function toggleMobileNav(e){
  if(e)e.preventDefault();
  const nav=$("#mobileNav"),btn=$("#burgerBtn");if(!nav)return;
  const opening=!nav.classList.contains('open');
  if(opening){nav.hidden=false;requestAnimationFrame(()=>nav.classList.add('open'));}
  else{nav.classList.remove('open');setTimeout(()=>{if(!nav.classList.contains('open'))nav.hidden=true;},280);}
  if(btn)btn.setAttribute('aria-expanded',opening?'true':'false');
}
function closeMobileNav(){
  const nav=$("#mobileNav"),btn=$("#burgerBtn");if(!nav||!nav.classList.contains('open'))return;
  nav.classList.remove('open');setTimeout(()=>{if(!nav.classList.contains('open'))nav.hidden=true;},280);
  if(btn)btn.setAttribute('aria-expanded','false');
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMobileNav();});
document.addEventListener('click',e=>{
  const nav=$("#mobileNav");if(!nav||!nav.classList.contains('open'))return;
  if(!nav.contains(e.target) && !e.target.closest('#burgerBtn')) closeMobileNav();
});
function searchKey(e){
  const box=$("#searchResults");if(!box||!box.classList.contains("show"))return;
  const items=[...box.querySelectorAll('.sr-item')];if(!items.length)return;
  if(e.key==='ArrowDown'){e.preventDefault();searchKbdIdx=Math.min(items.length-1,searchKbdIdx+1);}
  else if(e.key==='ArrowUp'){e.preventDefault();searchKbdIdx=Math.max(0,searchKbdIdx-1);}
  else if(e.key==='Enter'&&searchKbdIdx>=0){e.preventDefault();const p=PRODUCTS.filter(p=>{const q=$("#storeSearch").value.trim().toLowerCase();return p.name.toLowerCase().includes(q)||p.cat.toLowerCase().includes(q)||(p.desc||'').toLowerCase().includes(q);}).slice(0,6)[searchKbdIdx];if(p)openSearchResult(p.id);return;}
  else if(e.key==='Escape'){closeSearch();return;}
  items.forEach((it,i)=>it.classList.toggle('kbd',i===searchKbdIdx));
}

/* ---------- wishlist & account views (modal) ---------- */
function openWishlist(){
  const items=[...WISH].map(id=>PRODUCTS.find(p=>p.id===id)).filter(Boolean);
  $("#modalRoot").innerHTML=`<div class="modal-bg" onclick="closeModal()"></div>
   <div class="modal-card" role="dialog" aria-modal="true" aria-label="Wishlist"><div class="modal-head"><h3>Your Wishlist</h3><button class="x" aria-label="Close" onclick="closeModal()">×</button></div>
   <div class="modal-body">
     ${items.length?items.map(p=>`<div class="citem"><div class="ci-img"><img src="${primaryImg(p)}" alt="${escapeHtml(p.name)}"></div>
       <div class="ci-info"><h4>${p.name}</h4><div class="ci-price">${fmt(p.price)}</div>
       <div style="display:flex;gap:.5rem;margin-top:.4rem"><button class="btn btn-primary" style="padding:.4rem 1rem;font-size:.8rem" onclick="closeModal();openProduct(${p.id})">View</button>
       <a class="ci-remove" tabindex="0" role="button" onclick="toggleWish(${p.id},{stopPropagation:()=>{}});openWishlist()">Remove</a></div></div></div>`).join('')
     :'<div class="empty-cart"><div class="ec-ic">♡</div><p>Your wishlist is empty.</p></div>'}
   </div></div>`;
  $("#modalRoot").classList.add("show");
}
let accountTab="login"; // login | register | reset
let _resetStage="request"; // request | confirm  (password-reset sub-flow)
let _resetId="";           // remembered email/mobile across the two reset steps
/* Client request: the account opens as a full PAGE (person icon). Contextual logins
   from checkout/reviews still use a lightweight modal so they can return to that flow. */
function openAccount(){ accountTab="login"; navToAccountPage(); }
/* Navigate to the account page: render once, show it, scroll to top, then a ONE-TIME
   orders fetch that re-renders content only (no navigation/scroll → no loop). */
function navToAccountPage(){
  renderAccountPage();
  showSitePage('account'); closeMobileNav&&closeMobileNav(); window.scrollTo(0,0);
  try{ history.replaceState({},'','#/account'); }catch(_){}
  if(BACKEND && currentShopper()){ SDB.myOrders().then(res=>{ if(res&&res.orders){ MY_ORDERS=res.orders; if(_sitePage==='account') renderAccountPage(); } }); }
}
function setAccountTab(t){ accountTab=t; rerenderAccount(); }
/* Re-render whichever account surface is currently active (page or modal). */
function rerenderAccount(){
  if($("#modalRoot")?.classList.contains('show')) renderAccountModal();
  else renderAccountPage();
}
function renderAccountModal(){
  const {inner,title}=accountInnerHTML();
  $("#modalRoot").innerHTML=`<div class="modal-bg" onclick="closeModal()"></div>
   <div class="modal-card" role="dialog" aria-modal="true" aria-label="Account"><div class="modal-head"><h3>${title}</h3><button class="x" aria-label="Close" onclick="closeModal()">×</button></div>
   <div class="modal-body">${inner}</div></div>`;
  $("#modalRoot").classList.add("show");
}
/* Renders account content into the page — no navigation, no scroll, no fetch (so it's
   safe to call repeatedly, e.g. from the one-time orders refresh). */
function renderAccountPage(){
  const el=$("#accountPage"); if(!el) return;
  const {inner,title}=accountInnerHTML();
  el.innerHTML=`
    <div class="about-page-head">
      <div class="wrap"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="#/" onclick="goHomePage(event)">Home</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">${title}</span></nav>
      <h1>${title}</h1></div>
    </div>
    <div class="block"><div class="wrap"><div class="account-page-body">${inner}</div></div></div>`;
}
function accountInnerHTML(){
  const u=currentShopper();
  let inner;
  if(u){
    const orders=userOrders(u.email);
    const addrs=accountAddresses(u.email); _acctAddrs=addrs;
    inner=`
     <div class="acct-hello">
       <div class="acct-avatar">${escapeHtml((u.name||"?").trim().charAt(0).toUpperCase())}</div>
       <div><div class="acct-name">${escapeHtml(u.name)}</div>
       <div class="acct-email">${escapeHtml(u.email)}</div>
       ${u.phone?`<div class="acct-email">☎ ${escapeHtml(u.phone)}</div>`:''}</div>
       <button class="btn btn-ghost acct-logout" onclick="doLogout()">Sign out</button>
     </div>
     <div class="acct-section">
       <h4>Order history</h4>
       ${orders.length?orders.map(o=>`<div class="acct-order clickable" role="button" tabindex="0" onclick="openMyOrder('${escapeHtml(o.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openMyOrder('${escapeHtml(o.id)}');}"><span><b>${o.id}</b> · ${o.items} item${o.items>1?'s':''} · ${escapeHtml(o.date||'')}</span><span><span class="badge ${o.status}">${o.status}</span><span class="acct-order-arrow" aria-hidden="true">›</span></span></div>`).join('')
         :`<p class="acct-empty">No orders yet. When you place an order with this email, it appears here.</p>`}
     </div>
     <div class="acct-section">
       <div class="acct-sec-head"><h4>Saved addresses</h4><button class="btn-sm primary" id="aaAddBtn" onclick="startAddAddress()">＋ Add address</button></div>
       <div id="aaForm" class="aa-form" style="display:none">
         <div class="field row2"><div><label for="aaName">Full name *</label><input id="aaName" placeholder="Recipient name" oninput="clearAaError(this)"><div class="err-msg">Please enter the recipient's name.</div></div><div><label for="aaPhone">Phone *</label><input id="aaPhone" inputmode="numeric" maxlength="10" placeholder="10-digit mobile" oninput="clearAaError(this)"><div class="err-msg">Enter a valid 10-digit Indian mobile number.</div></div></div>
         <div class="field"><label for="aaAddr">Address *</label><textarea id="aaAddr" rows="2" placeholder="House, street, area" oninput="clearAaError(this)"></textarea><div class="err-msg">Please enter the delivery address.</div></div>
         <div class="field row2"><div><label for="aaPin">PIN code *</label><input id="aaPin" inputmode="numeric" maxlength="6" placeholder="560001" oninput="onAaPin();clearAaError(this)"><div class="err-msg">Enter a valid 6-digit PIN code.</div><div id="aaPinMsg" class="pin-msg" aria-live="polite"></div></div><div><label for="aaCity">City *</label><input id="aaCity" placeholder="Bengaluru" oninput="clearAaError(this)"><div class="err-msg">Please enter your city.</div></div></div>
         <div class="field"><label for="aaState">State *</label><input id="aaState" placeholder="Karnataka" oninput="clearAaError(this)"><div class="err-msg">Please enter your state.</div></div>
         <button class="btn btn-primary" id="aaSaveBtn" style="width:100%;justify-content:center" onclick="saveAccountAddress()">Save address</button>
       </div>
       ${addrs.length?addrs.map((a,i)=>`<div class="acct-addr"><span>${escapeHtml(a.name||'')}, ${escapeHtml(a.addr||'')}, ${escapeHtml(a.city||'')}${a.state?', '+escapeHtml(a.state):''} ${escapeHtml(a.pin||'')}${a.phone?` · ☎ ${escapeHtml(a.phone)}`:''}</span><span class="aa-actions"><button class="aa-edit" onclick="editAccountAddress(${i})" aria-label="Edit address" title="Edit">✎</button><button class="aa-remove" onclick="removeAccountAddress(${i})" aria-label="Remove address" title="Remove">✕</button></span></div>`).join('')
         :`<p class="acct-empty">No saved addresses yet. Add one here, or your delivery details are saved automatically when you check out.</p>`}
     </div>`;
  } else if(accountTab==="login"){
    inner=`
     <div class="login-err" id="acctErr"></div>
     <div class="field"><label for="acEmail">Email</label><input id="acEmail" type="text" placeholder="you@email.com" autocomplete="username"></div>
     <div class="field"><label for="acPass">Password</label><span class="pw-wrap"><input id="acPass" type="password" placeholder="••••••••" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()">${pwToggleHTML()}</span></div>
     <p class="acct-forgot"><a href="#" onclick="event.preventDefault();startPasswordReset()">Forgot password?</a></p>
     <button id="acLoginBtn" class="btn btn-primary" style="width:100%;justify-content:center" onclick="doLogin()">Sign In</button>
     <p class="acct-switch">New to Suddhalaya? <a href="#" onclick="event.preventDefault();setAccountTab('register')">Create an account</a></p>`;
  } else if(accountTab==="reset"){
    if(_resetStage==="confirm"){
      inner=`
       <div class="login-err" id="acctErr"></div>
       <p class="acct-hint">${_resetId.includes('@')?`We've emailed a code to <b>${escapeHtml(_resetId)}</b>.`:`We've emailed a reset code to the email address linked to your account.`} Enter it below and choose a new password.</p>
       <div class="field"><label for="rsCode">Reset code</label><input id="rsCode" inputmode="numeric" maxlength="10" placeholder="Enter the code from your email" autocomplete="one-time-code"></div>
       <div class="field"><label for="rsPass">New password</label><span class="pw-wrap"><input id="rsPass" type="password" placeholder="At least 6 characters" autocomplete="new-password" onkeydown="if(event.key==='Enter')doResetConfirm()">${pwToggleHTML()}</span></div>
       <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="doResetConfirm()">Reset password</button>
       <p class="acct-switch"><a href="#" onclick="event.preventDefault();doResetRequest()">Resend code</a> · <a href="#" onclick="event.preventDefault();setAccountTab('login')">Back to sign in</a></p>`;
    } else {
      inner=`
       <div class="login-err" id="acctErr"></div>
       <p class="acct-hint">Enter your email and we'll send you a code to reset your password.</p>
       <div class="field"><label for="rsId">Email</label><input id="rsId" type="text" value="${escapeHtml(_resetId||'')}" placeholder="you@email.com" autocomplete="username" onkeydown="if(event.key==='Enter')doResetRequest()"></div>
       <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="doResetRequest()">Send reset code</button>
       <p class="acct-switch"><a href="#" onclick="event.preventDefault();setAccountTab('login')">Back to sign in</a></p>`;
    }
  } else {
    inner=`
     <div class="login-err" id="acctErr"></div>
     <div class="field"><label for="acName">Full name *</label><input id="acName" type="text" placeholder="Your name" autocomplete="name" oninput="clearRegError(this)"><div class="err-msg">Please enter your name.</div></div>
     <div class="field"><label for="acEmail">Email *</label><input id="acEmail" type="email" placeholder="you@email.com" autocomplete="email" oninput="clearRegError(this)"><div class="err-msg">Enter a valid email address.</div></div>
     <div class="field"><label for="acPhone">Mobile number *</label><input id="acPhone" type="tel" inputmode="numeric" maxlength="10" placeholder="10-digit mobile" autocomplete="tel" oninput="clearRegError(this)"><div class="err-msg">Enter a valid 10-digit Indian mobile number.</div></div>
     <div class="field"><label for="acPass">Password *</label><span class="pw-wrap"><input id="acPass" type="password" placeholder="At least 6 characters" autocomplete="new-password" oninput="clearRegError(this)" onkeydown="if(event.key==='Enter')doRegister()">${pwToggleHTML()}</span><div class="err-msg">Password must be at least 6 characters.</div></div>
     <div class="field"><label for="acPass2">Confirm password *</label><span class="pw-wrap"><input id="acPass2" type="password" placeholder="Re-enter password" autocomplete="new-password" oninput="clearRegError(this)" onkeydown="if(event.key==='Enter')doRegister()">${pwToggleHTML()}</span><div class="err-msg">Passwords do not match.</div></div>
     <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="doRegister()">Create Account</button>
     <p class="acct-switch">Already have an account? <a href="#" onclick="event.preventDefault();setAccountTab('login')">Sign in</a></p>`;
  }
  const title = u?"Your Account":(accountTab==="login"?"Sign In":accountTab==="reset"?"Reset Password":"Create Account");
  return {inner, title};
}
function acctErr(m){const e=$("#acctErr");if(e){e.textContent=m;e.classList.add("show");}}
/* Show/hide password toggle for the auth forms (client feedback: "see password" option). */
function pwToggleHTML(){
  return `<button type="button" class="pw-toggle" aria-label="Show password" tabindex="0" onclick="togglePw(this)">
    <svg class="eye" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
    <svg class="eye-off" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-6.5 0-10-8-10-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/></svg>
  </button>`;
}
function togglePw(btn){
  const inp=btn.parentElement&&btn.parentElement.querySelector('input'); if(!inp) return;
  const willShow = inp.type==='password';
  inp.type = willShow ? 'text' : 'password';
  btn.classList.toggle('on', willShow);
  btn.setAttribute('aria-label', willShow ? 'Hide password' : 'Show password');
}
/* Button loading state: swaps the label for a spinner + text and disables the
   button while an async action (sign-in, etc.) is in flight. Spinner CSS is
   injected once so it works from the served engine with no stylesheet rebuild. */
function ensureSpinCss(){
  if(document.getElementById('btnSpinCss')) return;
  const st=document.createElement('style'); st.id='btnSpinCss';
  st.textContent='.btn-spin{display:inline-block;width:1em;height:1em;margin-right:.5em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-.15em;animation:btnspin .6s linear infinite}@keyframes btnspin{to{transform:rotate(360deg)}}.is-loading{opacity:.9;cursor:progress;pointer-events:none}';
  document.head.appendChild(st);
}
function setBtnLoading(btn, on, label){
  if(!btn) return;
  ensureSpinCss();
  if(on){
    if(btn.dataset.orig==null) btn.dataset.orig=btn.innerHTML;
    btn.disabled=true; btn.classList.add('is-loading');
    btn.innerHTML='<span class="btn-spin" aria-hidden="true"></span>'+(label||'Please wait…');
  } else {
    btn.disabled=false; btn.classList.remove('is-loading');
    if(btn.dataset.orig!=null){ btn.innerHTML=btn.dataset.orig; delete btn.dataset.orig; }
  }
}
async function doLogin(){
  const _b=$("#acLoginBtn"); setBtnLoading(_b,true,'Signing in…');
  try{
    if(BACKEND){
      const r=await SDB.login({identifier:$("#acEmail")?.value, password:$("#acPass")?.value});
      if(!r||!r.ok) return acctErr((r&&r.err)||"Could not sign in.");
      CURRENT_USER=r.user; MY_ORDERS=[];
      toast(`Welcome back, ${(r.user.name||'').split(' ')[0]||''}`); updateAccountUI();
      if(afterAuthReturn()) return;
      rerenderAccount(); return;
    }
    const r=loginUser($("#acEmail")?.value, $("#acPass")?.value);
    if(!r.ok)return acctErr(r.err);
    toast(`Welcome back, ${r.user.name.split(' ')[0]}`); updateAccountUI();
    if(afterAuthReturn()) return;
    rerenderAccount();
  } finally { setBtnLoading(_b,false); }
}
/* ---- Password reset (forgot password): emailed one-time code, two steps ---- */
function startPasswordReset(){
  // carry over whatever they typed on the sign-in form
  const typed=($("#acEmail")?.value||$("#rsId")?.value||_resetId||"").trim();
  _resetId=typed; accountTab="reset"; _resetStage="request"; rerenderAccount();
}
async function doResetRequest(){
  if(!BACKEND) return acctErr("Password reset is available on the live site.");
  const idv=($("#rsId")?.value||_resetId||"").trim();
  if(!idv) return acctErr("Enter your email or mobile number.");
  _resetId=idv;
  const r=await SDB.resetRequest({identifier:idv});
  if(!r||r.ok===false) return acctErr((r&&r.err)||"Could not send a reset code. Please try again.");
  _resetStage="confirm"; rerenderAccount();
  toast(r.message||"If an account exists, we've emailed a reset code.");
}
async function doResetConfirm(){
  if(!BACKEND) return acctErr("Password reset is available on the live site.");
  const code=($("#rsCode")?.value||"").trim();
  const pass=$("#rsPass")?.value||"";
  if(!code) return acctErr("Enter the code we emailed you.");
  if(pass.length<6) return acctErr("Password must be at least 6 characters.");
  const r=await SDB.resetConfirm({identifier:_resetId, code, password:pass});
  if(!r||r.ok===false) return acctErr((r&&r.err)||"Could not reset password.");
  accountTab="login"; _resetStage="request"; rerenderAccount();
  if($("#acEmail")) $("#acEmail").value=_resetId;
  toast("Password updated — please sign in with your new password.");
}
/* If the user came from checkout, drop them back into it (now signed in). */
function afterAuthReturn(){
  if(!_returnToCheckout) return false;
  _returnToCheckout=false;
  if(BACKEND){ SDB.myOrders().then(res=>{ if(res&&res.orders){ MY_ORDERS=res.orders; if($("#savedAddrPicker")) renderSavedAddrPicker(); } }); }
  openCheckout();
  return true;
}
/* Inline field validation for Create Account (mirrors checkout/address). Shows a
   clear per-field error before the server round-trip; server still handles
   duplicate email/mobile via the top banner. */
function validateRegister(){
  let ok=true;
  const set=(id,valid)=>{const el=document.getElementById(id);if(!el)return;const f=el.closest('.field');if(!f)return;
    if(valid)f.classList.remove('invalid'); else{f.classList.add('invalid');ok=false;}};
  const val=id=>(document.getElementById(id)?.value||'').trim();
  set('acName', val('acName').length>0);
  set('acEmail', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('acEmail')));
  set('acPhone', /^[6-9]\d{9}$/.test(val('acPhone').replace(/\D/g,'').slice(-10)));
  set('acPass', (document.getElementById('acPass')?.value||'').length>=6);
  set('acPass2', (document.getElementById('acPass2')?.value||'')===(document.getElementById('acPass')?.value||''));  // confirm matches
  return ok;
}
function clearRegError(el){ const f=el&&el.closest('.field'); if(f)f.classList.remove('invalid'); }
async function doRegister(){
  if(BACKEND){
    if(!validateRegister()){ acctErr('Please fix the highlighted fields.'); return; }
    const r=await SDB.signup({name:$("#acName")?.value, email:$("#acEmail")?.value, phone:$("#acPhone")?.value, password:$("#acPass")?.value});
    if(!r||!r.ok) return acctErr((r&&r.err)||"Could not create account.");
    CURRENT_USER=r.user; MY_ORDERS=[];
    toast(`Account created — welcome, ${(r.user.name||'').split(' ')[0]||''}`); updateAccountUI();
    if(afterAuthReturn()) return;
    rerenderAccount(); return;
  }
  const r=registerUser($("#acName")?.value, $("#acEmail")?.value, $("#acPhone")?.value, $("#acPass")?.value);
  if(!r.ok)return acctErr(r.err);
  // Surface the new shopper in the admin Customers list (client #11: "demo the user data")
  try{
    if(typeof CUSTOMERS!=='undefined' && !CUSTOMERS.some(c=>c.email===r.user.email)){
      CUSTOMERS.unshift({id:Date.now(),name:r.user.name,email:r.user.email,phone:r.user.phone||"",city:"",since:nowStamp().split(' ').slice(0,3).join(' '),tags:["registered"]});
      persist&&persist("customers",CUSTOMERS);
    }
  }catch(e){}
  toast(`Account created — welcome, ${r.user.name.split(' ')[0]}`); updateAccountUI();
  if(afterAuthReturn()) return;
  rerenderAccount();
}
async function doLogout(){
  if(BACKEND){ await SDB.logout(); CURRENT_USER=null; MY_ORDERS=[]; toast("Signed out"); updateAccountUI(); afterLogoutNav(); return; }
  logoutUser(); toast("Signed out"); updateAccountUI(); afterLogoutNav();
}
/* After sign-out: if the user was on the account page, send them home; if in a modal, refresh it. */
function afterLogoutNav(){
  if($("#modalRoot")?.classList.contains('show')) renderAccountModal();
  else if(_sitePage==='account') goHomePage();
}
/* reflect signed-in state on the header account button */
function updateAccountUI(){
  const btn=document.getElementById("acctBtn"); if(!btn)return;
  const u=currentShopper();
  btn.classList.toggle("signed-in", !!u);
  btn.title = u? `Account · ${u.name}` : "Login / Account";
  btn.setAttribute("aria-label", u? `Account, signed in as ${u.name}` : "Login / Account");
  const lbl=btn.querySelector('.acct-label');
  if(lbl) lbl.textContent = u ? (u.name||"Account").trim().split(/\s+/)[0] : "Login";
  if(typeof refreshWishlist==='function') refreshWishlist();   // wishlist appears only when signed in
}

/* ---------- structured data (JSON-LD) injection ---------- */
function injectProductSchema(list){
  let el=document.getElementById('product-schema');
  if(!el){el=document.createElement('script');el.type='application/ld+json';el.id='product-schema';document.head.appendChild(el);}
  const items=list.slice(0,12).map(p=>{
    const v=firstInStockVariant(p)||{};
    return {"@type":"Product","name":p.name,"category":p.cat,"sku":v.sku||p.sku,
      "aggregateRating":{"@type":"AggregateRating","ratingValue":p.rating,"reviewCount":p.reviews},
      "offers":{"@type":"Offer","priceCurrency":"INR","price":(v.price||p.price),"availability":(p.stock>0?"https://schema.org/InStock":"https://schema.org/OutOfStock")}};
  });
  el.textContent=JSON.stringify({"@context":"https://schema.org","@graph":items});
}
function injectFaqSchema(p){
  let el=document.getElementById('faq-schema');
  if(!el){el=document.createElement('script');el.type='application/ld+json';el.id='faq-schema';document.head.appendChild(el);}
  const faqs=(p.faqs||[]).map(f=>({"@type":"Question","name":f.q,"acceptedAnswer":{"@type":"Answer","text":f.a}}));
  el.textContent=JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":faqs});
}

/* ---------- cookie consent ---------- */
/* Client feedback (16 Aug): the cookie consent banner is removed. The site uses only
   essential (session) cookies; no analytics/marketing trackers are loaded. */
function initConsent(){ /* banner removed per client request */ }
function setConsent(v){try{localStorage.setItem(CONSENT_KEY,v);}catch(e){}const b=document.getElementById('cookieBanner');if(b)b.classList.remove('show');if(v==='accepted')loadTrackers();toast(v==='accepted'?'Cookies accepted':'Only essential cookies will be used');}
function loadTrackers(){/* production: inject GA4 + Meta Pixel only after consent */ window._sdlTrackersLoaded=true;}

function subscribe(){const e=$("#newsEmail").value;if(e&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){toast("Welcome to the Pantry Club! Check your inbox.");$("#newsEmail").value="";}else toast("Please enter a valid email");}
function subscribeFooter(){const el=$("#footNewsEmail");const e=el?el.value:"";if(e&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){toast("Subscribed! Welcome to a greener planet 🌱");el.value="";}else toast("Please enter a valid email");}
function goHome(e){ return goHomePage(e); }
/* ---- Client QA r2: multi-page storefront (Home / About) within the single-file engine.
   Sections are tagged data-page="home|about"; the router shows one page at a time so
   the home page is decluttered and About is a visually separate page. ---- */
const ABOUT_ANCHORS=['aboutTop','about','promise'];   // story & mission sections removed (client feedback)
const SHOP_ANCHORS=['shopTop','shop'];
let _sitePage='home';
function pageOfAnchor(id){ if(ABOUT_ANCHORS.includes(id))return 'about'; if(SHOP_ANCHORS.includes(id))return 'shop'; if(id==='privacyTop'||id==='privacy')return 'privacy'; if(id==='returnsTop'||id==='returns')return 'returns'; return 'home'; }
function showSitePage(page){
  _sitePage=page;
  if(typeof mobileSearchOpen==='function' && mobileSearchOpen()) closeMobileSearch();  // never let search linger over a new page
  document.querySelectorAll('[data-page]').forEach(el=>{ el.style.display=(el.getAttribute('data-page')===page)?'':'none'; });
  // reveal freshly-shown content (the IntersectionObserver may not re-fire for nodes already in view)
  document.querySelectorAll('[data-page="'+page+'"] .reveal, [data-page="'+page+'"].reveal, [data-page="'+page+'"] .reveal-stagger>*').forEach(el=>el.classList.add('is-visible'));
  // reflect active state in the primary nav
  document.querySelectorAll('.menu a').forEach(a=>a.classList.toggle('active', (a.getAttribute('data-nav')||'')===page));
  // honour the "reviews section" feature flag (don't let the home page re-show a hidden reviews block)
  if(typeof REVIEWS_ENABLED!=='undefined' && !REVIEWS_ENABLED){ const rev=document.getElementById('reviews'); if(rev) rev.style.display='none'; }
}
function goSection(id,e){
  if(e&&e.preventDefault)e.preventDefault();
  const page=pageOfAnchor(id), changing=(page!==_sitePage);
  showSitePage(page); closeMobileNav&&closeMobileNav();
  const atTop=(id==='aboutTop'||id==='shopTop'); // page-top anchor → just go to the very top
  const doScroll=()=>{ if(atTop){ window.scrollTo({top:0,behavior:changing?'auto':'smooth'}); return; } const t=document.getElementById(id); if(t)t.scrollIntoView({behavior:changing?'auto':'smooth',block:'start'}); else window.scrollTo({top:0,behavior:'smooth'}); };
  if(changing){ window.scrollTo(0,0); setTimeout(doScroll,40); } else doScroll();
  try{ history.replaceState({},'','#'+id); }catch(_){}
  return false;
}
function goHomePage(e){ if(e&&e.preventDefault)e.preventDefault(); showSitePage('home'); closeMobileNav&&closeMobileNav(); window.scrollTo({top:0,behavior:'smooth'}); try{history.replaceState({},'','#/');}catch(_){}; return false; }
function goAboutPage(e){ return goSection('aboutTop',e); }
function goShopPage(e){ return goSection('shopTop',e); }
function goPrivacyPage(e){ return goSection('privacyTop',e); }
function goReturnPage(e){ return goSection('returnsTop',e); }
function initSitePage(){
  const raw=(location.hash||'').replace(/^#\/?/,'').split('?')[0];
  if(raw==='account'){ if(typeof navToAccountPage==='function') navToAccountPage(); return; }
  const page=raw?pageOfAnchor(raw):'home';
  if(page!=='home'){
    showSitePage(page);
    const target=(raw==='shop')?'shopTop':(raw==='about')?'aboutTop':(raw==='privacy')?'privacyTop':(raw==='returns')?'returnsTop':raw;  // land on the page header band
    const t=document.getElementById(target); if(t) setTimeout(()=>t.scrollIntoView(),60);
  } else showSitePage('home');
}

/* ========== LOGIN / ADMIN ==========
   SECURITY NOTE (audit fix): the previous build hard-coded a plaintext password and
   displayed it as a hint. That is removed. This demo now stores only a SHA-256 HASH
   of the credential and never renders the password anywhere. In production, auth is
   server-side: hashed+salted password in a database, session/JWT tokens, real
   email-OTP via a transactional provider, brute-force lockout, and CSRF/XSS hardening.
   No credential is shipped in client code in production. */
let adminPassHash = null;        // set on first run; never the plaintext
let loginStage = "password";     // password -> otp -> in
let pendingOtp = "";
let otpExpires = 0;

async function sha256(str){
  if(window.crypto&&crypto.subtle){
    const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  // Fallback (non-secure context only): never used in production HTTPS deploys.
  let h=0;for(let i=0;i<str.length;i++){h=((h<<5)-h+str.charCodeAt(i))|0;}return 'fallback:'+h;
}
/* On first boot, derive the hash from a one-time setup value, then discard the
   plaintext from memory. (Demo bootstrap only — production sets this server-side.) */
(async()=>{ try{ const setup="SO@2026"; adminPassHash=await sha256(setup); }catch(e){} })();

function renderLogin(){
  $("#loginView").innerHTML=`
   <a class="back-site" onclick="route('/')">← Back to store</a>
   <div class="login-card">
     <div class="lc-logo"><img src="${brandLogo()}"></div>
     <h2>Admin Portal</h2>
     <p class="lc-sub">Suddhalaya inventory & operations</p>
     <div class="login-err" id="loginErr"></div>
     <div id="loginStageBox"></div>
   </div>`;
  renderLoginStage();
}
function renderLoginStage(){
  const box=$("#loginStageBox");
  if(loginStage==="password"){
    box.innerHTML=`
     <div class="field"><label for="luser">${BACKEND?'Email':'Username'}</label><input id="luser" type="${BACKEND?'email':'text'}" value="${BACKEND?'':'admin'}" placeholder="${BACKEND?'owner@suddhalaya.com':''}" autocomplete="${BACKEND?'username':'off'}"></div>
     <div class="field"><label for="lpass">Password</label><span class="pw-wrap"><input id="lpass" type="password" placeholder="••••••" autocomplete="current-password" onkeydown="if(event.key==='Enter')tryLogin()">${pwToggleHTML()}</span></div>
     <button id="adminLoginBtn" class="btn btn-primary" onclick="tryLogin()">Sign In</button>
     ${BACKEND?`<div class="login-hint" style="margin-top:.7rem"><a href="#" onclick="event.preventDefault();adminStartReset()" style="color:var(--gold)">Forgot password?</a></div>`:''}
     <div class="login-hint">${BACKEND?'Sign in with your staff account. Access is role-based and enforced server-side.':'Sign in with your admin credentials. First login triggers email-OTP verification. Credentials are never stored or shown in the page.'}</div>`;
  } else if(loginStage==="reset"){
    if(_resetStage==="confirm"){
      box.innerHTML=`
       <p style="font-size:.88rem;color:var(--muted);text-align:center;margin-bottom:.8rem">${_resetId.includes('@')?`We've emailed a reset code to<br><b style="color:var(--forest)">${escapeHtml(_resetId)}</b>`:`We've emailed a reset code to the email address linked to your account.`}</p>
       <div class="field"><label for="arCode">Reset code</label><input id="arCode" inputmode="numeric" maxlength="10" placeholder="Enter the code from your email" autocomplete="one-time-code"></div>
       <div class="field"><label for="arPass">New password</label><span class="pw-wrap"><input id="arPass" type="password" placeholder="At least 6 characters" autocomplete="new-password" onkeydown="if(event.key==='Enter')adminResetConfirm()">${pwToggleHTML()}</span></div>
       <button class="btn btn-primary" onclick="adminResetConfirm()">Reset password</button>
       <div class="login-hint"><a href="#" onclick="event.preventDefault();adminStartReset()" style="color:var(--gold)">Resend code</a> · <a href="#" onclick="event.preventDefault();loginStage='password';renderLoginStage()" style="color:var(--gold)">Back to sign in</a></div>`;
    } else {
      box.innerHTML=`
       <p style="font-size:.88rem;color:var(--muted);text-align:center;margin-bottom:.8rem">Enter your staff email and we'll email you a reset code.</p>
       <div class="field"><label for="arEmail">Email</label><input id="arEmail" type="email" value="${escapeHtml(_resetId||'')}" placeholder="you@suddhalaya.com" autocomplete="username" onkeydown="if(event.key==='Enter')adminResetRequest()"></div>
       <button class="btn btn-primary" onclick="adminResetRequest()">Send reset code</button>
       <div class="login-hint"><a href="#" onclick="event.preventDefault();loginStage='password';renderLoginStage()" style="color:var(--gold)">Back to sign in</a></div>`;
    }
  } else if(loginStage==="otp"){
    box.innerHTML=`
     <p style="font-size:.88rem;color:var(--muted);text-align:center;margin-bottom:.5rem">We sent a 6-digit code to<br><b style="color:var(--forest)">business@suddhalaya.com</b></p>
     <div class="otp-box">${[0,1,2,3,4,5].map(i=>`<input maxlength="1" id="otp${i}" inputmode="numeric" aria-label="OTP digit ${i+1}" oninput="otpHop(${i})">`).join('')}</div>
     <p style="text-align:center;font-size:.78rem;color:var(--muted);margin-bottom:1rem">The code expires in 5 minutes. In production it is emailed via your transactional provider and never shown on screen.</p>
     <button class="btn btn-primary" onclick="verifyOtp()">Verify & Enter</button>
     <div class="login-hint">Didn't get it? <a href="#" onclick="event.preventDefault();resendOtp()" style="color:var(--gold)">Resend code</a></div>`;
    setTimeout(()=>$("#otp0")?.focus(),100);
  }
}
function showErr(m){const e=$("#loginErr");e.textContent=m;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),3000);}
function genOtp(){pendingOtp=String(Math.floor(100000+Math.random()*900000));otpExpires=Date.now()+5*60*1000;
  // Demo delivery: shown via a transient toast, NOT embedded in page source.
  // Production: emailed via transactional provider; never surfaced to the client.
  toast("Demo OTP sent: "+pendingOtp);
}
async function tryLogin(){
  const _b=$("#adminLoginBtn"); setBtnLoading(_b,true,'Signing in…');
  try{
    const u=$("#luser").value.trim(),p=$("#lpass").value;
    if(BACKEND){
      const r=await SDBA.login({email:u, password:p});
      if(!r || !r.ok){ showErr((r&&r.err)||"Sign in failed."); return; }
      currentUser={name:r.name, role:r.role};
      await loadAdminData();
      loginStage="in"; route('/admin');
      return;
    }
    const hash=await sha256(p);
    if(u!=="admin"||hash!==adminPassHash){showErr("Invalid username or password.");return;}
    genOtp();loginStage="otp";renderLoginStage();
  } finally { setBtnLoading(_b,false); }
}
function resendOtp(){genOtp();}
function otpHop(i){const v=$("#otp"+i).value;if(v&&i<5)$("#otp"+(i+1)).focus();}
function verifyOtp(){
  if(Date.now()>otpExpires){showErr("Code expired. Please resend.");return;}
  let code="";for(let i=0;i<6;i++)code+=$("#otp"+i).value;
  if(code!==pendingOtp){showErr("Incorrect code. Check and retry.");return;}
  loginStage="in";route('/admin');
}
function adminLogout(){ if(BACKEND) SDBA.logout(); loginStage="password"; route('/'); }
/* Admin password reset — reuses the emailed-code flow (works for any staff Supabase user). */
function adminStartReset(){
  const em=($("#luser")?.value||$("#arEmail")?.value||_resetId||"").trim();
  _resetId=em; loginStage="reset"; _resetStage="request"; renderLoginStage();
}
async function adminResetRequest(){
  const em=($("#arEmail")?.value||_resetId||"").trim();
  if(!em){ showErr("Enter your email."); return; }
  _resetId=em;
  const r=await SDB.resetRequest({identifier:em});
  if(!r || r.ok===false){ showErr((r&&r.err)||"Could not send a reset code."); return; }
  _resetStage="confirm"; renderLoginStage();
  toast(r.message||"If an account exists, we've emailed a reset code.");
}
async function adminResetConfirm(){
  const code=($("#arCode")?.value||"").trim(), pass=$("#arPass")?.value||"";
  if(!code){ showErr("Enter the code we emailed you."); return; }
  if(pass.length<6){ showErr("Password must be at least 6 characters."); return; }
  const r=await SDB.resetConfirm({identifier:_resetId, code, password:pass});
  if(!r || r.ok===false){ showErr((r&&r.err)||"Could not reset password."); return; }
  loginStage="password"; renderLoginStage();
  toast("Password updated — please sign in with your new password.");
}

/* ===================================================================
   ADMIN PANEL — rebuilt per audit (P0/P1/P2 findings)
   Modules: Dashboard, Orders (+detail+lifecycle), Inventory (paginated/sortable),
   Products (full editor + add), Categories, Customers, Coupons, Returns,
   Payments, Reports, CMS, Audit Log, Roles, Settings. Everything persists.
   =================================================================== */
let adminTab="dashboard";
const ADMIN_NAV = [
  {group:"Overview", items:[["dashboard","▦","Dashboard"],["orders","▣","Orders"],["returns","↩","Returns"]]},
  {group:"Catalog", items:[["inventory","▤","Inventory"],["products","◫","Products"],["categories","❏","Categories"],["add","＋","Add Product"]]},
  {group:"Customers & Money", items:[["customers","☺","Customers"],["payments","₹","Payments"],["coupons","％","Coupons"],["reports","◔","Reports"]]},
  {group:"System", items:[["cms","✎","Content"],["audit","☷","Audit Log"],["roles","⚿","Roles"],["settings","⚙","Settings"]]}
];
function renderAdmin(){
  $("#adminView").innerHTML=`
   <div class="admin-top"><div class="wrap">
     <div class="at-brand"><span class="dot"></span> ${escapeHtml(SETTINGS.storeName)} · Admin</div>
     <div class="at-actions"><span class="at-credit">Designed &amp; Engineered by <a href="https://www.imperialtechinnovations.com/" target="_blank" rel="noopener">Imperial Tech Innovations</a></span><span style="color:var(--gold-soft)">${escapeHtml(currentUser.name)} · ${ROLES[currentUser.role].label}</span><button onclick="route('/')">View Store ↗</button><button onclick="adminLogout()">Logout</button></div>
   </div></div>
   <div class="admin-shell">
     <nav class="admin-side">
       ${ADMIN_NAV.map(g=>`<div class="nav-group">${g.group}</div>`+g.items.map(it=>`<a class="${adminTab===it[0]?'active':''}" onclick="adminGo('${it[0]}')"><span class="ico">${it[1]}</span> ${it[2]}</a>`).join('')).join('')}
       <div class="admin-credit">Designed &amp; Engineered by<br><a href="https://www.imperialtechinnovations.com/" target="_blank" rel="noopener">Imperial Tech Innovations</a></div>
     </nav>
     <main class="admin-main" id="adminMain"></main>
   </div>
   <div class="admin-foot">© 2026 ${escapeHtml(SETTINGS.storeName)} · Admin Console — Designed &amp; Engineered by <a href="https://www.imperialtechinnovations.com/" target="_blank" rel="noopener">Imperial Tech Innovations</a></div>`;
  renderAdminTab();
}
function adminGo(t){adminTab=t;orderDetailId=null;renderAdmin();}

/* shared computed helpers */
function lowStockProducts(){return PRODUCTS.filter(p=>{const t=lowThreshold(p);return t>0&&p.stock>0&&p.stock<=t;});}
function outStockProducts(){return PRODUCTS.filter(p=>p.stock===0);}
function inStockProducts(){return PRODUCTS.filter(p=>stockState(p.stock,lowThreshold(p))==='in');}  // matches the 'in' inventory filter
function paidRevenue(){return ORDERS.filter(o=>o.payment&&o.payment.status==="paid").reduce((s,o)=>s+o.total,0);}
function pendingRevenue(){return ORDERS.filter(o=>o.payment&&o.payment.status==="pending").reduce((s,o)=>s+o.total,0);}

function renderAdminTab(){
  const m=$("#adminMain");
  switch(adminTab){
    case 'dashboard': return renderDashboard(m);
    case 'orders': return orderDetailId?renderOrderDetail(m):renderOrders(m);
    case 'returns': return renderReturns(m);
    case 'inventory': return renderInventory(m);
    case 'products': return renderProducts_admin(m);
    case 'categories': return renderCategories(m);
    case 'add': return renderAddProduct(m);
    case 'customers': return renderCustomers(m);
    case 'payments': return renderPayments(m);
    case 'coupons': return renderCoupons(m);
    case 'reports': return renderReports(m);
    case 'cms': return renderCMS(m);
    case 'audit': return renderAuditLog(m);
    case 'roles': return renderRoles(m);
    case 'settings': return renderSettings(m);
  }
}

/* ---------------- DASHBOARD (audit P2 #3: live KPIs + action queues) -------------- */
/* --- dashboard drill-downs: land on the right tab WITH the expected filter --- */
function dashGoOrders(filter){ orderFilter=filter||'all'; orderSearch=''; orderDetailId=null; adminGo('orders'); }
function dashGoPayments(filter){ payFilter=filter||'all'; adminGo('payments'); }
function dashGoReturns(filter){ returnFilter=filter||'all'; adminGo('returns'); }
function dashGoInventory(filter){ invStatusFilter=filter||'all'; invFilter=''; invPage=1; invView='stock'; adminGo('inventory'); }
function dashGoTab(t){ adminGo(t); }
/* keyboard a11y for the tiles */
function dashKey(e,fn){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); fn(); } }
function renderDashboard(m){
  const toShip=ORDERS.filter(o=>FULFIL_STATUSES.includes(o.status)).length;
  const failedPay=ORDERS.filter(o=>o.payment&&o.payment.status==='pending').length;
  const pendingReturns=RETURNS.filter(r=>r.status==='requested').length;
  const lowN=lowStockProducts().length, outN=outStockProducts().length;
  const tile=(fn)=>`role="button" tabindex="0" class="stat clickable" onclick="${fn}" onkeydown="dashKey(event,()=>{${fn}})"`;
  m.innerHTML=`<h1>Dashboard</h1><p class="admin-sub">Live overview · ${nowStamp()} — every tile opens its report</p>
  <div class="stat-row">
    <div ${tile("dashGoTab('reports')")} title="Open the revenue report"><div class="sl">Paid Revenue</div><b>${fmt(paidRevenue())}</b><div class="delta">${ORDERS.length} orders →</div></div>
    <div ${tile("dashGoPayments('pending')")} title="Open Payments awaiting capture"><div class="sl">Pending / COD</div><b>${fmt(pendingRevenue())}</b><div class="delta ${pendingRevenue()?'down':''}">${failedPay} awaiting capture →</div></div>
    <div ${tile("dashGoInventory('all')")} title="Open Inventory"><div class="sl">Units in Stock</div><b>${PRODUCTS.reduce((s,p)=>s+(p.stock||0),0)}</b><div class="delta ${lowN?'down':''}">
      <a onclick="event.stopPropagation();dashGoInventory('low')" style="text-decoration:underline;cursor:pointer">${lowN} low</a> ·
      <a onclick="event.stopPropagation();dashGoInventory('out')" style="text-decoration:underline;cursor:pointer">${outN} out</a></div></div>
    <div ${tile("dashGoTab('customers')")} title="Open Customers"><div class="sl">Customers</div><b>${CUSTOMERS.length}</b><div class="delta">${PRODUCTS.length} SKUs live →</div></div>
  </div>
  <h3 style="margin:.5rem 0 1rem;font-size:1.1rem">Action queues</h3>
  <div class="stat-row">
    <div class="queue-card" role="button" tabindex="0" onclick="dashGoOrders('tofulfil')" onkeydown="dashKey(event,()=>dashGoOrders('tofulfil'))" title="Orders filtered to paid · processing · packed"><div><div class="sl" style="font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)">To fulfil</div><div class="qn">${toShip}</div></div><span style="font-size:1.4rem">▣</span></div>
    <div class="queue-card" role="button" tabindex="0" onclick="dashGoPayments('pending')" onkeydown="dashKey(event,()=>dashGoPayments('pending'))" title="Payments awaiting capture"><div><div class="sl" style="font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)">Payments to verify</div><div class="qn">${failedPay}</div></div><span style="font-size:1.4rem">₹</span></div>
    <div class="queue-card" role="button" tabindex="0" onclick="dashGoReturns('requested')" onkeydown="dashKey(event,()=>dashGoReturns('requested'))" title="Returns awaiting action"><div><div class="sl" style="font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)">Returns to action</div><div class="qn">${pendingReturns}</div></div><span style="font-size:1.4rem">↩</span></div>
    <div class="queue-card" role="button" tabindex="0" onclick="dashGoInventory('lowout')" onkeydown="dashKey(event,()=>dashGoInventory('lowout'))" title="Inventory filtered to low + out of stock"><div><div class="sl" style="font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)">Low / out of stock</div><div class="qn">${lowN+outN}</div></div><span style="font-size:1.4rem">▤</span></div>
  </div>
  <div class="admin-panel"><div class="panel-head"><h3>Recent Orders</h3><button class="btn-sm" onclick="adminGo('orders')">View all</button></div>
  <table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>
  ${ORDERS.slice(0,6).map(o=>`<tr style="cursor:pointer" onclick="openOrder('${o.id}')"><td><b>${o.id}</b></td><td>${escapeHtml(o.customer)}</td><td>${o.items}</td><td>${fmt(o.total)}</td><td><span class="badge ${o.payment.status}">${o.payment.status}</span></td><td><span class="badge ${o.status}">${o.status}</span></td></tr>`).join('')}
  </tbody></table></div>`;
}

/* ---------------- ORDERS (audit P0 #2, P1 #10) ---------------- */
let orderDetailId=null, orderFilter="all", orderSearch="";
function openOrder(id){orderDetailId=id;renderAdmin();}
function setOrderFilter(v){orderFilter=v;renderAdminTab();}
function setOrderSearch(v){orderSearch=v.toLowerCase();renderAdminTab();}
/* statuses that still need fulfilling — shared by the dashboard tile + orders filter */
const FULFIL_STATUSES=['paid','processing','packed'];
function renderOrders(m){
  let list=ORDERS.slice();
  if(orderFilter==="tofulfil") list=list.filter(o=>FULFIL_STATUSES.includes(o.status));
  else if(orderFilter!=="all") list=list.filter(o=>o.status===orderFilter);
  if(orderSearch) list=list.filter(o=>o.id.toLowerCase().includes(orderSearch)||o.customer.toLowerCase().includes(orderSearch));
  m.innerHTML=`<h1>Orders</h1><p class="admin-sub">Full lifecycle management with line items, payment, fulfilment and audit trail.</p>
  <div class="tool-row">
    <input class="admin-search" placeholder="Search order id or customer…" oninput="setOrderSearch(this.value)" value="${escapeHtml(orderSearch)}">
    <select class="adm-select" onchange="setOrderFilter(this.value)">
      <option value="all">All statuses</option>
      <option value="tofulfil" ${orderFilter==='tofulfil'?'selected':''}>To fulfil (paid · processing · packed)</option>
      ${ALL_STATUSES.map(s=>`<option value="${s}" ${orderFilter===s?'selected':''}>${s}</option>`).join('')}
    </select>
    <div class="spacer"></div>
    <button class="btn-sm" onclick="exportOrdersCSV()">⭳ Export CSV</button>
  </div>
  <div class="admin-panel"><div class="panel-head"><h3>${list.length} order${list.length!==1?'s':''}</h3></div>
  <table><thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.length?list.map(o=>`<tr>
    <td><b>${o.id}</b></td><td>${escapeHtml(o.customer)}</td><td style="color:var(--muted)">${o.date}</td><td>${o.items}</td><td>${fmt(o.total)}</td>
    <td><span class="badge ${o.payment.status}">${o.payment.method.toUpperCase()} · ${o.payment.status}</span></td>
    <td><span class="badge ${o.status}">${o.status}</span></td>
    <td><button class="btn-sm" onclick="openOrder('${o.id}')">Open →</button></td></tr>`).join(''):`<tr><td colspan="8"><div class="empty-state"><div class="ic">▣</div>No orders match.</div></td></tr>`}
  </tbody></table></div>`;
}
function renderOrderDetail(m){
  const o=ORDERS.find(x=>x.id===orderDetailId); if(!o){orderDetailId=null;return renderOrders(m);}
  const tax=orderTaxBreakup(o);
  const taxTotal=round2(Object.values(tax).reduce((s,v)=>s+v,0));
  // Real GST invoices split tax into CGST + SGST (intra-state). Each is half the rate.
  const taxRows=Object.keys(tax).sort().filter(r=>+r>0).map(r=>{
    const half=tax[r]/2;
    return `<div class="kv"><span>CGST @ ${(+r/2)}%</span><span>+ ${fmt(half)}</span></div>`+
           `<div class="kv"><span>SGST @ ${(+r/2)}%</span><span>+ ${fmt(tax[r]-half)}</span></div>`;
  }).join('');
  const nexts=allowedNext(o.status);
  m.innerHTML=`
  <div class="crumb" onclick="orderDetailId=null;renderAdmin()">← Back to orders</div>
  <h1>${o.id} <span class="badge ${o.status}" style="font-size:.8rem;vertical-align:middle">${o.status}</span></h1>
  <p class="admin-sub">${o.date} · ${escapeHtml(o.customer)} · ${o.items} items · ${fmt(o.total)}</p>
  <div class="detail-grid">
    <div>
      <div class="dcard" style="margin-bottom:1.2rem"><div class="dh">Line items</div><div class="db" style="padding:0">
        <table><thead><tr><th>Product</th><th>HSN</th><th>Variant</th><th>Qty</th><th>Unit</th><th>GST</th><th>Line</th></tr></thead><tbody>
        ${o.lines.map(l=>{const pr=PRODUCTS.find(p=>(p.variants||[]).some(v=>v.sku===l.sku));const hsn=pr?pr.hsn:'—';return `<tr><td><b>${escapeHtml(l.name)}</b><br><small style="color:var(--muted)">${l.sku}</small></td><td>${hsn}</td><td>${l.variant}</td><td>${l.qty}</td><td>${fmt(l.price)}</td><td>${l.gst}%</td><td>${fmt(l.price*l.qty)}</td></tr>`;}).join('')}
        </tbody></table>
      </div></div>
      <div class="dcard"><div class="dh">Order timeline</div><div class="db">
        <ul class="timeline">${(o.timeline||[]).slice().reverse().map(e=>`<li><div>${escapeHtml(e.note)}</div><div class="tt">${e.t} · ${e.actor}</div></li>`).join('')}</ul>
      </div></div>
    </div>
    <div>
      <div class="dcard" style="margin-bottom:1.2rem"><div class="dh">Advance status</div><div class="db">
        <p style="font-size:.82rem;color:var(--muted);margin-bottom:.6rem">Transitions follow the lifecycle state machine — only valid next states are offered, each with real side effects.</p>
        <select class="adm-select" id="osel" style="width:100%;margin-bottom:.6rem">
          ${nexts.map(s=>`<option value="${s}" ${o.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <button class="btn-sm primary" style="width:100%;justify-content:center" onclick="advanceOrder('${o.id}')">Apply transition</button>
      </div></div>
      <div class="dcard" style="margin-bottom:1.2rem"><div class="dh">Payment</div><div class="db">
        <div class="kv"><span>Method</span><span>${o.payment.method.toUpperCase()}</span></div>
        <div class="kv"><span>Status</span><span><span class="badge ${o.payment.status}">${o.payment.status}</span></span></div>
        <div class="kv"><span>Gateway</span><span>${o.payment.gateway||'—'}</span></div>
        <div class="kv"><span>Txn ID</span><span style="font-size:.78rem">${o.payment.txnId||'—'}</span></div>
        ${o.payment.invoice?`<div class="kv"><span>Invoice</span><span>${o.payment.invoice}</span></div>`:''}
        ${o.payment.status==='pending'?`<button class="btn-sm primary" style="width:100%;margin-top:.6rem;justify-content:center" onclick="capturePayment('${o.id}')">Mark payment captured</button>`:''}
      </div></div>
      <div class="dcard" style="margin-bottom:1.2rem"><div class="dh">Totals</div><div class="db">
        <div class="kv"><span>Subtotal (excl. GST)</span><span>${fmt(round2(orderSubtotal(o)-taxTotal))}</span></div>
        ${taxRows}
        <div class="kv"><span>Shipping</span><span>${o.shipTotal?'+ '+fmt(o.shipTotal):'Free'}</span></div>
        <div class="kv" style="font-weight:600"><span>Total</span><span>${fmt(o.total)}</span></div>
      </div></div>
      <div class="dcard"><div class="dh">Ship to</div><div class="db" style="font-size:.86rem;line-height:1.6">
        <b>${escapeHtml(o.ship.name||o.customer)}</b><br>${escapeHtml(o.ship.line||'—')}<br>${escapeHtml(o.ship.city||'')} ${escapeHtml(o.ship.state||'')} ${o.ship.pin||''}<br>
        <span style="color:var(--muted)">${escapeHtml(o.email||'')} · ${o.phone||''}</span>
        ${o.tracking?`<div style="margin-top:.6rem;padding-top:.6rem;border-top:1px solid var(--line)"><b>${o.tracking.carrier}</b> · ${o.tracking.awb}</div>`:''}
      </div></div>
    </div>
  </div>`;
}
function advanceOrder(id){
  const o=ORDERS.find(x=>x.id===id); if(!o)return;
  const target=$("#osel").value; if(target===o.status){toast("No change");return;}
  if(!allowedNext(o.status).includes(target)){toast("Invalid transition");return;}
  const prev=o.status; o.status=target;
  o.timeline=o.timeline||[]; o.timeline.push({t:nowStamp(),actor:currentUser.name,note:`Status ${prev} → ${target}`});
  // side effects bound to transitions (audit P0 #2 / §11)
  if(target==='packed'&&!o.tracking){o.tracking={carrier:"Delhivery",awb:"DL"+Math.floor(2840110000+Math.random()*9999),url:"https://www.delhivery.com/track"};o.timeline.push({t:nowStamp(),actor:"system",note:"AWB "+o.tracking.awb+" booked (Delhivery)"});}
  if(target==='shipped'){notify(o.email,"Your order has shipped",`${o.id} is on its way${o.tracking?` — track ${o.tracking.awb}`:''}.`);o.timeline.push({t:nowStamp(),actor:"system",note:"Shipment notification sent"});}
  if(target==='out-for-delivery'){notify(o.email,"Out for delivery",`${o.id} is out for delivery today.`);}
  if(target==='delivered'){notify(o.email,"Delivered",`${o.id} was delivered. Thank you!`);}
  if(target==='cancelled'){ // restock
    o.lines.forEach(l=>{const p=PRODUCTS.find(pp=>(pp.variants||[]).some(v=>v.sku===l.sku));if(p){const v=p.variants.find(v=>v.sku===l.sku);if(v)v.stock+=l.qty;syncProductFromVariants(p);}});
    o.timeline.push({t:nowStamp(),actor:"system",note:"Stock restocked on cancellation"});
    notify(o.email,"Order cancelled",`${o.id} has been cancelled.`);
  }
  o.items=orderItemsCount(o); o.total=orderTotal(o);
  adminSync('order.status',{orderNo:id, status:target, note:`Status ${prev} → ${target}`, actor:currentUser.name, at:nowStamp(), tracking:o.tracking||null, restock: target==='cancelled'? o.lines.map(l=>({sku:l.sku,qty:l.qty})) : null});
  logAudit("order.status",id,`${prev} → ${target}`);
  persistAll();
  toast(`${id} → ${target}`);
  renderAdmin();
}
function capturePayment(id){
  const o=ORDERS.find(x=>x.id===id); if(!o)return;
  o.payment.status="paid"; o.payment.txnId=o.payment.txnId||("pay_"+Math.random().toString(36).slice(2,12));
  o.payment.capturedAt=nowStamp(); o.payment.gateway=o.payment.gateway==="COD"?"COD (collected)":"Razorpay";
  if(!o.payment.invoice){o.payment.invoice=nextInvoiceNo();o.timeline.push({t:nowStamp(),actor:"system",note:"GST invoice "+o.payment.invoice+" generated"});}
  o.timeline.push({t:nowStamp(),actor:currentUser.name,note:"Payment marked captured"});
  if(o.status==='payment-pending')o.status='processing';
  adminSync('payment.capture',{orderNo:o.id, txnId:o.payment.txnId, gateway:o.payment.gateway, capturedAt:o.payment.capturedAt, invoice:o.payment.invoice, status:o.status, note:'Payment marked captured', actor:currentUser.name, at:nowStamp()});
  logAudit("payment.capture",id,o.payment.txnId);
  notify(o.email,"Payment received",`We have received payment for ${o.id}.`);
  persistAll(); toast("Payment captured"); renderAdmin();
}
function exportOrdersCSV(){
  const rows=[["Order","Customer","Email","Date","Items","Subtotal","Tax","Shipping","Total","Payment","Status"]];
  ORDERS.forEach(o=>rows.push([o.id,o.customer,o.email||'',o.date,o.items,round2(orderSubtotal(o)),round2(orderTaxTotal(o)),o.shipTotal||0,round2(o.total),o.payment.method+"/"+o.payment.status,o.status]));
  downloadCSV(rows,"suddhalaya_orders.csv"); logAudit("orders.export","—",ORDERS.length+" rows");
}

/* ---------------- RETURNS / RMA (audit P1 #3) ---------------- */
let returnFilter="all";
function setReturnFilter(v){returnFilter=v;renderAdminTab();}
function renderReturns(m){
  const list=returnFilter==="all"?RETURNS:RETURNS.filter(r=>r.status===returnFilter);
  m.innerHTML=`<h1>Returns & Refunds</h1><p class="admin-sub">RMA intake, approval, refund issuance and conditional restock.</p>
  <div class="tool-row"><button class="btn-sm primary" onclick="newReturn()">＋ New RMA</button>
    <select class="adm-select" onchange="setReturnFilter(this.value)">
      <option value="all" ${returnFilter==='all'?'selected':''}>All returns</option>
      <option value="requested" ${returnFilter==='requested'?'selected':''}>To action (requested)</option>
      <option value="approved" ${returnFilter==='approved'?'selected':''}>Approved</option>
      <option value="rejected" ${returnFilter==='rejected'?'selected':''}>Rejected</option>
    </select>
    <div class="spacer"></div></div>
  <div class="admin-panel"><div class="panel-head"><h3>${list.length} return${list.length!==1?'s':''}${returnFilter!=='all'?' · '+returnFilter:''}</h3></div>
  <table><thead><tr><th>RMA</th><th>Order</th><th>Customer</th><th>Item</th><th>Reason</th><th>Refund</th><th>Status</th><th>Actions</th></tr></thead><tbody>
  ${list.length?list.map(r=>`<tr>
    <td><b>${r.id}</b></td><td>${r.orderId}</td><td>${escapeHtml(r.customer)}</td><td style="color:var(--muted)">${r.sku}</td><td>${escapeHtml(r.reason)}</td><td>${fmt(r.refund)}</td>
    <td><span class="badge ${r.status}">${r.status}</span></td>
    <td><div class="row-actions">
      ${r.status==='requested'?`<button class="btn-sm primary" onclick="setReturn('${r.id}','approved')">Approve</button><button class="btn-sm danger" onclick="setReturn('${r.id}','rejected')">Reject</button>`:''}
      ${r.status==='approved'?`<button class="btn-sm primary" onclick="refundReturn('${r.id}')">Refund ${fmt(r.refund)}</button>`:''}
    </div></td></tr>`).join(''):`<tr><td colspan="8"><div class="empty-state"><div class="ic">↩</div>${returnFilter==='all'?'No returns yet.':'No '+returnFilter+' returns.'}</div></td></tr>`}
  </tbody></table></div>`;
}
function newReturn(){
  const oid=prompt("Order ID for the return (e.g. #SDL2039):"); if(!oid)return;
  const o=ORDERS.find(x=>x.id===oid.trim()); if(!o){toast("Order not found");return;}
  const reason=prompt("Return reason:")||"Not specified";
  const r={id:"RMA-"+Math.floor(1005+Math.random()*900),orderId:o.id,customer:o.customer,sku:o.lines[0]?.sku||'—',reason,status:"requested",refund:round2(orderSubtotal(o)),date:nowStamp().split(' ').slice(0,3).join(' '),restock:false};
  RETURNS.unshift(r); adminSync('return.upsert',{return:r}); logAudit("return.create",r.id,o.id); persistAll(); toast("RMA created"); renderAdminTab();
}
function setReturn(id,status){
  const r=RETURNS.find(x=>x.id===id); if(!r)return; r.status=status;
  adminSync('return.upsert',{return:r});
  logAudit("return."+status,id,r.orderId); notify("",""); persistAll();
  toast("RMA "+status); renderAdminTab();
}
function refundReturn(id){
  const r=RETURNS.find(x=>x.id===id); if(!r)return;
  r.status="rejected"; // close out as refunded path
  const o=ORDERS.find(x=>x.id===r.orderId);
  if(o){o.status="refunded";o.payment.status="refunded";o.timeline.push({t:nowStamp(),actor:currentUser.name,note:`Refund ${fmt(r.refund)} issued via ${o.payment.gateway||'gateway'}`});
    // conditional restock
    const p=PRODUCTS.find(pp=>(pp.variants||[]).some(v=>v.sku===r.sku));
    if(p){const v=p.variants.find(v=>v.sku===r.sku);if(v)v.stock+=1;syncProductFromVariants(p);r.restock=true;}
  }
  r.status="approved";
  adminSync('return.upsert',{return:r});
  if(o) adminSync('order.status',{orderNo:o.id, status:'refunded', paymentStatus:'refunded', note:`Refund ${fmt(r.refund)} issued via ${o.payment.gateway||'gateway'}`, actor:currentUser.name, at:nowStamp(), restock: r.restock?[{sku:r.sku,qty:1}]:null});
  logAudit("refund.issue",id,fmt(r.refund)); notify(o?o.email:"","Refund issued",`A refund of ${fmt(r.refund)} for ${r.orderId} has been processed.`);
  persistAll(); toast("Refund issued & restocked"); renderAdminTab();
}

/* ---------------- INVENTORY (audit P2 #2: pagination/sort/filter; P0 #3 stock fix) ---------------- */
let invFilter="", invSort={key:"name",dir:1}, invPage=1, invStatusFilter="all";
const INV_PAGE_SIZE=8;
function invSearch(v){invFilter=v.toLowerCase();invPage=1;renderInventory($("#adminMain"));}
function invSetStatus(v){invStatusFilter=v;invPage=1;renderInventory($("#adminMain"));}
function invSetSort(key){if(invSort.key===key)invSort.dir*=-1;else{invSort.key=key;invSort.dir=1;}renderInventory($("#adminMain"));}
function invPageGo(d){invPage+=d;renderInventory($("#adminMain"));}
function invList(){
  let list=PRODUCTS.filter(p=>p.name.toLowerCase().includes(invFilter)||p.sku.toLowerCase().includes(invFilter)||(p.variants||[]).some(v=>v.sku.toLowerCase().includes(invFilter)));
  if(invStatusFilter==="low")list=list.filter(p=>{const t=lowThreshold(p);return t>0&&p.stock>0&&p.stock<=t;});
  else if(invStatusFilter==="out")list=list.filter(p=>p.stock===0);
  else if(invStatusFilter==="lowout")list=list.filter(p=>{const t=lowThreshold(p);return p.stock===0||(t>0&&p.stock>0&&p.stock<=t);});
  else if(invStatusFilter==="in")list=list.filter(p=>{const t=lowThreshold(p);return p.stock>0&&(t<=0||p.stock>t);});   // uses each product's own threshold
  const k=invSort.key;
  list.sort((a,b)=>{let av=a[k],bv=b[k];if(k==='price'||k==='stock'){return (av-bv)*invSort.dir;}return String(av).localeCompare(String(bv))*invSort.dir;});
  return list;
}
let invView='stock';   // 'stock' | 'warehouses'
function invSetView(v){ invView=v; renderInventory($("#adminMain")); }
/* clickable KPI tile — filters the inventory list to the matching stock status */
function invStatTile(status,label,count,color){
  const active=invStatusFilter===status;
  const col=color?` style="color:${color}"`:'';
  return `<div class="stat clickable${active?' active':''}" role="button" tabindex="0" aria-pressed="${active}"
    title="Show ${label.toLowerCase()}" onclick="invSetStatus('${status}')"
    onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();invSetStatus('${status}');}">
    <div class="sl">${label}</div><b${col}>${count}</b></div>`;
}
function renderInventory(m){
  if(invView==='warehouses') return renderWarehouses(m);
  const full=invList();
  const pages=Math.max(1,Math.ceil(full.length/INV_PAGE_SIZE));
  invPage=Math.min(Math.max(1,invPage),pages);
  const list=full.slice((invPage-1)*INV_PAGE_SIZE,invPage*INV_PAGE_SIZE);
  const arr=k=>invSort.key===k?(invSort.dir>0?'▲':'▼'):'';
  m.innerHTML=`<h1>Inventory</h1><p class="admin-sub">Per-variant stock control with reservations-aware edits. Changes persist and reflect on the storefront.</p>
  <div class="stat-row">
    ${invStatTile('all','Total SKUs',PRODUCTS.length,'')}
    ${invStatTile('in','In Stock',inStockProducts().length,'')}
    ${invStatTile('low','Low Stock',lowStockProducts().length,'#b8741f')}
    ${invStatTile('out','Out of Stock',outStockProducts().length,'#c0392b')}
  </div>
  <div class="tool-row">
    <input class="admin-search" placeholder="Search products…" oninput="invSearch(this.value)" value="${escapeHtml(invFilter)}">
    <select class="adm-select" onchange="invSetStatus(this.value)">
      <option value="all" ${invStatusFilter==='all'?'selected':''}>All stock levels</option>
      <option value="in" ${invStatusFilter==='in'?'selected':''}>In stock</option>
      <option value="low" ${invStatusFilter==='low'?'selected':''}>Low stock</option>
      <option value="out" ${invStatusFilter==='out'?'selected':''}>Out of stock</option>
      <option value="lowout" ${invStatusFilter==='lowout'?'selected':''}>Low + Out of stock</option>
    </select>
    <div class="spacer"></div>
    <button class="btn-sm" onclick="invSetView('warehouses')">🏬 Warehouses</button>
    <button class="btn-sm" onclick="exportInventoryCSV()">⭳ Export CSV</button>
    <button class="btn-sm" onclick="$('#csvFile').click()">⭱ Import CSV</button>
    <input type="file" id="csvFile" accept=".csv" style="display:none" onchange="importInventoryCSV(this)">
  </div>
  <div class="admin-panel"><div class="panel-head"><h3>${full.length} product${full.length!==1?'s':''}</h3></div>
  <table><thead><tr>
    <th class="sortable" onclick="invSetSort('name')">Product <span class="arr">${arr('name')}</span></th>
    <th>SKU</th>
    <th class="sortable" onclick="invSetSort('price')">Price <span class="arr">${arr('price')}</span></th>
    <th class="sortable" onclick="invSetSort('stock')">Stock <span class="arr">${arr('stock')}</span></th>
    <th>Status</th><th>Actions</th></tr></thead>
  <tbody id="invBody"></tbody></table>
  <div class="pager">Page ${invPage} of ${pages} <button onclick="invPageGo(-1)" ${invPage<=1?'disabled':''}>‹ Prev</button> <button onclick="invPageGo(1)" ${invPage>=pages?'disabled':''}>Next ›</button></div>
  </div>`;
  renderInvRows(list);
}
function renderInvRows(list){
  const body=$("#invBody");if(!body)return;
  body.innerHTML=list.map(p=>{const lt=lowThreshold(p);const ss=stockState(p.stock,lt);const vcount=(p.variants||[]).length;return `<tr>
    <td><div class="t-prod"><div class="tp-img"><img src="${primaryImg(p)}" alt=""></div><div><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.cat)}${vcount>1?` · ${vcount} variants`:''}</small></div></div></td>
    <td style="color:var(--muted)">${p.sku}</td>
    <td>${fmt(p.price)}</td>
    <td><div class="stock-edit"><input type="number" min="0" step="1" value="${Math.max(0,p.stock||0)}" id="st${p.id}" aria-label="Total stock for ${escapeHtml(p.name)}"><button class="ra save" onclick="saveStock(${p.id})" title="Save total">✓</button></div></td>
    <td><span class="badge ${ss}" title="${lt>0?('Low-stock alert at or below '+lt):'Low-stock alert off'}">${ss==='in'?'In Stock':ss==='low'?'Low':'Out'}</span>${lt>0?`<br><small style="color:var(--muted);font-size:.66rem">alert ≤ ${lt}</small>`:''}</td>
    <td><div class="row-actions">
      <button class="ra" onclick="openBatches(${p.id})" title="Batches & manufacture dates" aria-label="Batches">📦</button>
      ${vcount>1?`<button class="ra" onclick="editVariants(${p.id})" title="Edit variants" aria-label="Edit variants">⊞</button>`:''}
      <button class="ra" onclick="openProductEditor(${p.id})" title="Edit product" aria-label="Edit">✎</button>
      <button class="ra" onclick="cloneProduct(${p.id})" title="Clone" aria-label="Clone">⧉</button>
      <button class="ra del" onclick="deleteProduct(${p.id})" title="Archive" aria-label="Archive">🗑</button>
    </div></div></td>
  </tr>`;}).join('');
}
/* FIXED stock editor (audit P0 #3 / §7.4): proportionally distributes a new total
   across variants WITHOUT zeroing the others. Single-variant stays exact. */
function saveStock(id){
  const val=parseInt($("#st"+id).value); if(isNaN(val)||val<0){toast("Enter a valid quantity");return;}
  const p=PRODUCTS.find(x=>x.id===id); if(!p)return;
  const vs=p.variants||[];
  if(vs.length<=1){ if(vs.length)vs[0].stock=val; }
  else {
    const cur=vs.reduce((s,v)=>s+v.stock,0);
    if(cur===0){ // distribute as evenly as possible across variants
      const each=Math.floor(val/vs.length); let rem=val-each*vs.length;
      vs.forEach(v=>{v.stock=each+(rem-->0?1:0);});
    } else { // preserve each variant's proportion of the old total
      let allocated=0;
      vs.forEach((v,i)=>{ if(i===vs.length-1){v.stock=Math.max(0,val-allocated);} else {const share=Math.round(val*(v.stock/cur));v.stock=share;allocated+=share;} });
    }
  }
  const before=p.stock; syncProductFromVariants(p);
  adminSync('product.upsert',{product:p});
  logAudit("inventory.stock",p.sku,`${before} → ${p.stock}`);
  persistAll(); renderInventory($("#adminMain")); toast("Stock updated & saved");
}
function editVariants(id){
  const p=PRODUCTS.find(x=>x.id===id); if(!p)return;
  $("#modalRoot").innerHTML=`<div class="modal-bg" onclick="closeModal()"></div>
   <div class="modal-card" role="dialog" aria-modal="true" style="max-width:640px"><div class="modal-head"><h3>Variants · ${escapeHtml(p.name)}</h3><button class="x" onclick="closeModal()">×</button></div>
   <div class="modal-body">
     <p style="font-size:.82rem;color:var(--muted);margin-bottom:.8rem">Edit each variant independently — price, MRP and stock per SKU.</p>
     <div class="var-row" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)"><div>Label</div><div>SKU</div><div>Price</div><div>MRP</div><div>Stock</div><div></div></div>
     ${p.variants.map((v,i)=>`<div class="var-row">
       <input value="${escapeHtml(v.label)}" id="vl${i}"><input value="${v.sku}" id="vs${i}"><input type="number" min="0" step="1" value="${v.price}" id="vp${i}"><input type="number" min="0" step="1" value="${v.mrp}" id="vm${i}"><input type="number" min="0" step="1" value="${Math.max(0,v.stock||0)}" id="vk${i}">
       <button class="ra del" onclick="this.closest('.var-row').remove()" title="Remove">×</button></div>`).join('')}
     <button class="btn-sm" onclick="saveVariants(${id})" style="margin-top:.6rem">Save variants</button>
   </div></div>`;
  $("#modalRoot").classList.add("show");
}
function saveVariants(id){
  const p=PRODUCTS.find(x=>x.id===id); if(!p)return;
  const rows=document.querySelectorAll('#modalRoot .var-row');
  const newVars=[];
  rows.forEach((row,i)=>{ // first row is the header (has no inputs)
    const lab=row.querySelector('[id^="vl"]'); if(!lab)return;
    const idx=lab.id.replace('vl','');
    newVars.push({label:$("#vl"+idx).value,sku:$("#vs"+idx).value,price:Math.max(0,parseInt($("#vp"+idx).value)||0),mrp:Math.max(0,parseInt($("#vm"+idx).value)||0),stock:Math.max(0,parseInt($("#vk"+idx).value)||0)});
  });
  if(newVars.length){p.variants=newVars;syncProductFromVariants(p);adminSync('product.upsert',{product:p});logAudit("product.variants",p.sku,newVars.length+" variants");persistAll();closeModal();renderInventory($("#adminMain"));toast("Variants saved");}
}
function exportInventoryCSV(){
  const rows=[["Product","SKU","Category","Price","MRP","Stock","GST"]];
  PRODUCTS.forEach(p=>rows.push([p.name,p.sku,p.cat,p.price,p.mrp,p.stock,p.gst]));
  downloadCSV(rows,"suddhalaya_inventory.csv"); logAudit("inventory.export","—",PRODUCTS.length+" rows");
}

/* =================== Phase 4.1: Warehouses management =================== */
function renderWarehouses(m){
  m.innerHTML=`<h1>Warehouses</h1><p class="admin-sub">Storage locations that hold batch stock. FIFO fulfilment picks the oldest manufacture date across warehouses.</p>
  <div class="tool-row"><button class="btn-sm primary" onclick="warehouseForm(0)">＋ New warehouse</button><div class="spacer"></div><button class="btn-sm" onclick="invSetView('stock')">← Back to stock</button></div>
  <div class="admin-panel"><div class="panel-head"><h3>${WAREHOUSES.length} warehouse${WAREHOUSES.length!==1?'s':''}</h3></div>
  <table><thead><tr><th>Name</th><th>Code</th><th>City</th><th>State</th><th>PIN</th><th>Default</th><th>Active</th><th>Actions</th></tr></thead><tbody>
  ${WAREHOUSES.map(w=>`<tr>
    <td><b>${escapeHtml(w.name)}</b></td><td style="color:var(--muted)">${escapeHtml(w.code)}</td><td>${escapeHtml(w.city||'—')}</td><td>${escapeHtml(w.state||'—')}</td><td>${escapeHtml(w.pincode||'—')}</td>
    <td>${w.isDefault?'<span class="badge in">Default</span>':''}</td>
    <td><span class="badge ${w.active?'in':'low'}">${w.active?'Active':'Inactive'}</span></td>
    <td><div class="row-actions"><button class="btn-sm" onclick="warehouseForm(${w.id})">Edit</button><button class="ra ${w.active?'del':''}" onclick="toggleWarehouse(${w.id})" title="${w.active?'Deactivate':'Activate'}">${w.active?'⊘':'✓'}</button></div></td>
  </tr>`).join('')}
  </tbody></table></div>`;
}
function warehouseForm(id){
  const w = id? WAREHOUSES.find(x=>x.id===id) : {name:'',code:'',city:'',state:'',pincode:'',address:'',active:true,isDefault:false};
  if(!w) return;
  $("#modalRoot").innerHTML=`<div class="modal-bg" onclick="closeModal()"></div>
   <div class="modal-card" role="dialog" aria-modal="true" style="max-width:520px"><div class="modal-head"><h3>${id?'Edit':'New'} warehouse</h3><button class="x" onclick="closeModal()">×</button></div>
   <div class="modal-body">
     <div class="field row2"><div><label>Name</label><input id="whName" value="${escapeHtml(w.name)}"></div><div><label>Code</label><input id="whCode" value="${escapeHtml(w.code)}" ${id?'readonly':''} placeholder="MAIN"></div></div>
     <div class="field row2"><div><label>City</label><input id="whCity" value="${escapeHtml(w.city||'')}"></div><div><label>State</label><input id="whState" value="${escapeHtml(w.state||'')}"></div></div>
     <div class="field row2"><div><label>PIN code</label><input id="whPin" value="${escapeHtml(w.pincode||'')}"></div><div><label>Address</label><input id="whAddr" value="${escapeHtml(w.address||'')}"></div></div>
     <div style="display:flex;align-items:center;gap:.6rem;margin:.6rem 0"><div class="tog ${w.isDefault?'on':''}" id="whDef" onclick="this.classList.toggle('on')"></div><span style="font-size:.86rem">Default warehouse (used for restocks)</span></div>
     <button class="btn-sm primary" onclick="saveWarehouse(${id||0})">Save warehouse</button>
   </div></div>`;
  $("#modalRoot").classList.add("show");
}
function saveWarehouse(id){
  const name=$("#whName").value.trim(), code=$("#whCode").value.trim().toUpperCase();
  if(!name||!code){toast("Name and code are required");return;}
  const isDefault=$("#whDef").classList.contains('on');
  if(isDefault) WAREHOUSES.forEach(w=>w.isDefault=false);
  const rec={ id: id||Date.now(), name, code, city:$("#whCity").value.trim(), state:$("#whState").value.trim(), pincode:$("#whPin").value.trim(), address:$("#whAddr").value.trim(), active:true, isDefault };
  const existing = id? WAREHOUSES.find(w=>w.id===id) : WAREHOUSES.find(w=>w.code===code);
  if(existing){ Object.assign(existing, rec, {id:existing.id, active:existing.active}); } else { WAREHOUSES.push(rec); }
  adminSync('warehouse.upsert',{warehouse:rec});
  persist('warehouses',WAREHOUSES); logAudit("warehouse.upsert",code,name); closeModal(); renderWarehouses($("#adminMain")); toast("Warehouse saved");
}
function toggleWarehouse(id){
  const w=WAREHOUSES.find(x=>x.id===id); if(!w)return; w.active=!w.active;
  if(w.active) adminSync('warehouse.upsert',{warehouse:w}); else adminSync('warehouse.delete',{id:w.id, code:w.code});
  persist('warehouses',WAREHOUSES); renderWarehouses($("#adminMain")); toast("Warehouse "+(w.active?'activated':'deactivated'));
}

/* =================== Phase 4.1: Batches per variant =================== */
let batchProductId=null, batchVariantSku=null, _batchData={batches:[],movements:[]};
async function openBatches(pid){
  batchProductId=pid; const p=PRODUCTS.find(x=>x.id===pid); if(!p)return;
  batchVariantSku=(p.variants&&p.variants[0])?p.variants[0].sku:null;
  $("#modalRoot").innerHTML=`<div class="modal-bg" onclick="closeModal()"></div>
   <div class="modal-card" role="dialog" aria-modal="true" style="max-width:760px"><div class="modal-head"><h3>Batches · ${escapeHtml(p.name)}</h3><button class="x" onclick="closeModal()">×</button></div>
   <div class="modal-body" id="batchBody"><p style="color:var(--muted)">Loading…</p></div></div>`;
  $("#modalRoot").classList.add("show");
  await loadBatches();
}
async function loadBatches(){
  const p=PRODUCTS.find(x=>x.id===batchProductId); if(!p)return;
  const v=(p.variants||[]).find(x=>x.sku===batchVariantSku)||p.variants[0]; batchVariantSku=v&&v.sku;
  if(BACKEND && v&&v.id){
    const r=await SDBA.inventory(v.id);
    _batchData = (r&&r.ok)? {batches:r.batches||[], movements:r.movements||[]} : {batches:[],movements:[]};
  } else {
    _batchData = { batches:(v&&Array.isArray(v.batches)?v.batches:[]).map((b,i)=>({...b, id:(b.id!=null?b.id:('L'+i))})), movements:[] };
  }
  renderBatchModal();
}
function batchSelectVariant(sku){ batchVariantSku=sku; loadBatches(); }
function renderBatchModal(){
  const body=$("#batchBody"); if(!body)return;
  const p=PRODUCTS.find(x=>x.id===batchProductId); if(!p)return;
  const v=(p.variants||[]).find(x=>x.sku===batchVariantSku)||p.variants[0];
  const whOpts=WAREHOUSES.filter(w=>w.active).map(w=>`<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('')||'<option value="">No active warehouse</option>';
  const rows=_batchData.batches.map(b=>{
    const es=batchExpiryState(b.expiryDate);
    const badge=es==='expired'?'<span class="badge low">Expired</span>':es==='soon'?'<span class="badge" style="background:#f5e2b8;color:#8a6a1a">≤30 days</span>':'';
    return `<tr class="batch-${es}">
      <td><b>${escapeHtml(b.batchNo)}</b></td>
      <td>${escapeHtml(b.mfgDate||'—')}</td>
      <td>${b.expiryDate?escapeHtml(b.expiryDate)+' ':''}${badge||(b.expiryDate?'':'—')}</td>
      <td>${escapeHtml(b.warehouse?b.warehouse.name:warehouseName(b.warehouseId))}</td>
      <td>${b.received}</td><td><b>${b.remaining}</b></td>
      <td><div class="row-actions"><button class="ra" title="Adjust remaining" onclick="adjustBatchPrompt('${b.id}',${b.remaining})">✎</button><button class="ra" title="Transfer warehouse" onclick="transferBatchPrompt('${b.id}',${b.remaining})">⇄</button></div></td>
    </tr>`;}).join('') || `<tr><td colspan="7"><div class="empty-state"><div class="ic">📦</div>No batches yet — receive stock below.</div></td></tr>`;
  const total=_batchData.batches.reduce((s,b)=>s+(+b.remaining||0),0);
  body.innerHTML=`
    ${(p.variants||[]).length>1?`<div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.9rem">${p.variants.map(x=>`<button class="btn-sm ${x.sku===batchVariantSku?'primary':''}" onclick="batchSelectVariant('${x.sku}')">${escapeHtml(x.label)}</button>`).join('')}</div>`:''}
    <p style="font-size:.85rem;color:var(--muted);margin-bottom:.6rem">Variant <b>${escapeHtml(v?v.label:'')}</b> · ${escapeHtml(batchVariantSku||'')} · <b>${total}</b> units in ${_batchData.batches.length} batch(es)</p>
    <div style="overflow-x:auto"><table class="batch-table"><thead><tr><th>Batch</th><th>Mfg</th><th>Expiry</th><th>Warehouse</th><th>Recv</th><th>Left</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="admin-panel" style="margin-top:1.1rem"><div class="panel-head"><h3>Receive stock</h3></div><div style="padding:1.1rem">
      <div class="field row2"><div><label>Batch / lot no.</label><input id="rbNo" placeholder="e.g. B-2026-07"></div><div><label>Warehouse</label><select id="rbWh">${whOpts}</select></div></div>
      <div class="field"><label>Source (sets the audit reason)</label><select id="rbReason">
        <option value="receive">Supplier receipt — new stock purchased</option>
        <option value="return_restock">Customer return / RTO — goods coming back</option>
        <option value="adjustment">Found in stock-take — correction</option>
      </select></div>
      <div class="field row2"><div><label>Mfg date</label><input id="rbMfg" type="date"></div><div><label>Expiry date (optional)</label><input id="rbExp" type="date"></div></div>
      <div class="field row2"><div><label>Quantity</label><input id="rbQty" type="number" min="1" placeholder="100"></div><div><label>Cost/unit ₹ (optional)</label><input id="rbCost" type="number" min="0" step="0.01"></div></div>
      <button class="btn-sm primary" onclick="receiveBatch()">Add to stock</button>
      <p style="font-size:.76rem;color:var(--muted);margin-top:.5rem">Tip: refunds &amp; cancellations already restock automatically — only use “Customer return” here for goods coming back outside an order refund (e.g. courier RTO), so you don't double-count.</p>
    </div></div>`;
}
async function receiveBatch(){
  const p=PRODUCTS.find(x=>x.id===batchProductId); if(!p)return;
  const v=(p.variants||[]).find(x=>x.sku===batchVariantSku)||p.variants[0];
  const batchNo=$("#rbNo").value.trim(), whId=parseInt($("#rbWh").value), mfg=$("#rbMfg").value, exp=$("#rbExp").value||null, qty=parseInt($("#rbQty").value)||0, cost=$("#rbCost").value?parseFloat($("#rbCost").value):null;
  const reason=($("#rbReason")&&$("#rbReason").value)||'receive';
  if(!batchNo){toast("Batch number required");return;}
  if(!mfg){toast("Manufacture date required");return;}
  if(qty<=0){toast("Enter a valid quantity");return;}
  if(!whId){toast("Add an active warehouse first");return;}
  if(BACKEND && v&&v.id){
    const r=await SDBA.op('batch.receive',{variantId:v.id, warehouseId:whId, batchNo, mfgDate:mfg, expiryDate:exp, qty, costPrice:cost, actor:currentUser.name, reason});
    if(!r||!r.ok){toast((r&&r.err)||'Receive failed');return;}
  } else {
    offlineReceive(p,v,whId,batchNo,mfg,exp,qty,cost);
  }
  const srcLabel={receive:'received',return_restock:'returned to stock',adjustment:'added (stock-take)'}[reason]||'received';
  logAudit("batch."+(reason==='receive'?'receive':reason), v?v.sku:'', batchNo+" +"+qty); toast(qty+" units "+srcLabel);
  await loadBatches(); if(invView==='stock') renderInventory($("#adminMain"));
}
async function adjustBatchPrompt(batchId, current){
  const val=prompt("New remaining quantity for this batch:", current); if(val===null)return;
  const n=parseInt(val); if(isNaN(n)||n<0){toast("Enter a valid quantity");return;}
  const p=PRODUCTS.find(x=>x.id===batchProductId); const v=(p.variants||[]).find(x=>x.sku===batchVariantSku)||p.variants[0];
  if(BACKEND){
    const r=await SDBA.op('batch.adjust',{batchId:Number(batchId), newRemaining:n, reason:'adjustment', actor:currentUser.name, note:'admin adjust'});
    if(!r||!r.ok){toast((r&&r.err)||'Adjust failed');return;}
  } else {
    const b=(v.batches||[]).find(x=>String(x.id)===String(batchId)); if(b){ if(n>b.received)b.received=n; b.remaining=n; } v.stock=variantRemaining(v); syncProductFromVariants(p); persistAll();
  }
  logAudit("batch.adjust",v?v.sku:'', batchId+" → "+n); toast("Batch adjusted");
  await loadBatches(); if(invView==='stock') renderInventory($("#adminMain"));
}
async function transferBatchPrompt(batchId, remaining){
  const active=WAREHOUSES.filter(w=>w.active);
  if(active.length<2){toast("Add another warehouse to transfer");return;}
  const to=prompt("Destination warehouse code:\n"+active.map(w=>"• "+w.code+" — "+w.name).join("\n")); if(!to)return;
  const dest=WAREHOUSES.find(w=>w.code.toUpperCase()===to.trim().toUpperCase()&&w.active); if(!dest){toast("Unknown warehouse code");return;}
  const q=parseInt(prompt("Quantity to transfer (max "+remaining+"):", Math.min(remaining,1))); if(isNaN(q)||q<=0)return;
  if(q>remaining){toast("Exceeds remaining");return;}
  const p=PRODUCTS.find(x=>x.id===batchProductId); const v=(p.variants||[]).find(x=>x.sku===batchVariantSku)||p.variants[0];
  if(BACKEND){
    const r=await SDBA.op('batch.transfer',{batchId:Number(batchId), toWarehouseId:dest.id, qty:q, actor:currentUser.name});
    if(!r||!r.ok){toast((r&&r.err)||'Transfer failed');return;}
  } else {
    const b=(v.batches||[]).find(x=>String(x.id)===String(batchId));
    if(b){ b.received-=q; b.remaining-=q; let d=v.batches.find(x=>x.batchNo===b.batchNo&&x.warehouseId===dest.id); if(d){d.received+=q;d.remaining+=q;} else v.batches.push({id:'L'+Date.now(),batchNo:b.batchNo,mfgDate:b.mfgDate,expiryDate:b.expiryDate,warehouseId:dest.id,received:q,remaining:q,costPrice:b.costPrice}); }
    v.stock=variantRemaining(v); syncProductFromVariants(p); persistAll();
  }
  logAudit("batch.transfer",v?v.sku:'', batchId+" → "+dest.code+" x"+q); toast("Transferred "+q+" units");
  await loadBatches(); if(invView==='stock') renderInventory($("#adminMain"));
}
/* offline: receive stock into a variant's batch array + refresh the derived mirror */
function offlineReceive(p,v,whId,batchNo,mfg,exp,qty,cost){
  v.batches=v.batches||[];
  let b=v.batches.find(x=>x.batchNo===batchNo && x.warehouseId===whId);
  if(b){ b.received+=qty; b.remaining+=qty; if(exp)b.expiryDate=exp; if(cost!=null)b.costPrice=cost; }
  else v.batches.push({id:'L'+Date.now(), batchNo, mfgDate:mfg, expiryDate:exp, warehouseId:whId, received:qty, remaining:qty, costPrice:cost});
  v.stock=variantRemaining(v); syncProductFromVariants(p); persistAll();
}
function importInventoryCSV(input){
  const file=input.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const lines=e.target.result.split(/\r?\n/).filter(Boolean);
      const header=lines.shift().split(',').map(s=>s.trim().toLowerCase());
      const iSku=header.indexOf('sku'), iStock=header.indexOf('stock'), iPrice=header.indexOf('price');
      let updated=0;
      lines.forEach(ln=>{const c=ln.split(',');const sku=(c[iSku]||'').trim();
        const p=PRODUCTS.find(pp=>pp.sku===sku||(pp.variants||[]).some(v=>v.sku===sku));
        if(p){if(iStock>=0&&c[iStock]!==undefined){const v=p.variants[0];if(v)v.stock=parseInt(c[iStock])||0;}
              if(iPrice>=0&&c[iPrice]!==undefined){const v=p.variants[0];if(v)v.price=parseInt(c[iPrice])||v.price;}
              syncProductFromVariants(p);updated++;}});
      logAudit("inventory.import","—",updated+" rows"); persistAll(); renderInventory($("#adminMain")); toast(updated+" products updated from CSV");
    }catch(err){toast("CSV parse failed");}
  };
  reader.readAsText(file); input.value="";
}
function downloadCSV(rows,filename){
  const csv=rows.map(r=>r.map(c=>{const s=String(c);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}

/* ---------------- PRODUCTS (full list + editor, audit P1 #6 / §7.2) ---------------- */
function renderProducts_admin(m){
  m.innerHTML=`<h1>Products</h1><p class="admin-sub">Full catalog with editable price, description, SEO, tax class, and publish state.</p>
  <div class="tool-row"><button class="btn-sm primary" onclick="adminGo('add')">＋ Add product</button><div class="spacer"></div><button class="btn-sm" onclick="exportInventoryCSV()">⭳ Export catalog</button></div>
  <div class="admin-panel"><div class="panel-head"><h3>${PRODUCTS.length} products</h3></div>
  <table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>GST</th><th>State</th><th>Actions</th></tr></thead><tbody>
  ${PRODUCTS.map(p=>`<tr>
    <td><div class="t-prod"><div class="tp-img"><img src="${primaryImg(p)}" alt=""></div><div><b>${escapeHtml(p.name)}</b><small>${p.sku}</small></div></div></td>
    <td>${escapeHtml(p.cat)}</td><td>${fmt(p.price)}</td><td>${p.gst}%</td>
    <td><span class="badge ${p.draft?'low':'in'}">${p.draft?'Draft':'Published'}</span></td>
    <td><div class="row-actions"><button class="btn-sm" onclick="openProductEditor(${p.id})">Edit</button><button class="ra" onclick="cloneProduct(${p.id})" title="Clone">⧉</button><button class="ra del" onclick="deleteProduct(${p.id})" title="Archive">🗑</button></div></td>
  </tr>`).join('')}
  </tbody></table></div>`;
}
let _editFaqs=[];
function epFaqSync(){ // read the current FAQ inputs back into the working array
  _editFaqs=_editFaqs.map((f,i)=>({q:($("#epFaqQ"+i)?.value??f.q)||"",a:($("#epFaqA"+i)?.value??f.a)||""}));
}
function epFaqListHTML(){
  return _editFaqs.map((f,i)=>`<div class="ep-faq" style="border:1px solid var(--line);border-radius:10px;padding:.8rem;margin-bottom:.6rem;background:var(--white)">
    <div class="field" style="margin-bottom:.5rem"><label>Question ${i+1}</label><input id="epFaqQ${i}" value="${escapeHtml(f.q)}" placeholder="e.g. Is this A2 ghee?"></div>
    <div class="field" style="margin-bottom:.5rem"><label>Answer</label><textarea id="epFaqA${i}" rows="2" placeholder="Answer shown to shoppers…">${escapeHtml(f.a)}</textarea></div>
    <button class="btn-sm" onclick="epFaqRemove(${i})">Remove</button>
  </div>`).join('')||`<p style="color:var(--muted);font-size:.85rem;margin-bottom:.6rem">No FAQs yet. Add the questions shoppers commonly ask.</p>`;
}
function epFaqRender(){const el=$("#epFaqList");if(el)el.innerHTML=epFaqListHTML();}
function epFaqAdd(){epFaqSync();_editFaqs.push({q:"",a:""});epFaqRender();}
function epFaqRemove(i){epFaqSync();_editFaqs.splice(i,1);epFaqRender();}
/* ---- Phase 4.4: product image upload (Supabase Storage backend, data-URL offline) ---- */
let _editImages=[];
function epImgListHTML(){
  if(!_editImages.length) return '<p style="color:var(--muted);font-size:.85rem;margin-bottom:.5rem">No images yet — storefront falls back to the built-in photo/illustration for this SKU.</p>';
  return '<div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:.5rem">'+_editImages.map((u,i)=>`<div style="position:relative;width:78px;height:78px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--cream-deep)">${i===0?'<span style="position:absolute;bottom:0;left:0;right:0;background:rgba(31,53,32,.8);color:#fff;font-size:.6rem;text-align:center;padding:1px">MAIN</span>':''}<img src="${u}" alt="" style="width:100%;height:100%;object-fit:cover"><button onclick="epImgRemove(${i})" title="Remove" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:18px;height:18px;line-height:1;cursor:pointer;font-size:.72rem">×</button></div>`).join('')+'</div>';
}
function epImgRender(){const el=$("#epImgList");if(el)el.innerHTML=epImgListHTML();}
function epImgRemove(i){_editImages.splice(i,1);epImgRender();}
async function epImgAdd(input){
  const f=input.files&&input.files[0]; if(!f)return;
  if(f.size>5*1024*1024){toast("Image too large — max 5 MB");input.value="";return;}
  const dataUrl=await new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.readAsDataURL(f);});
  input.value="";
  if(BACKEND){
    toast("Uploading…");
    const r=await SDBA.upload(dataUrl, f.name);
    if(!r||!r.ok){toast((r&&r.err)||"Upload failed");return;}
    _editImages.push(r.url);
  } else {
    _editImages.push(dataUrl);   // offline: keep the data URL inline
  }
  epImgRender();
}
/* ---- variant manager inside the product Edit modal (add / edit / remove) ---- */
let _editVariants=[];
function epVarSync(){
  _editVariants=_editVariants.map((v,i)=>({
    label:($("#epVl"+i)?.value ?? v.label)||"",
    sku:  ($("#epVs"+i)?.value ?? v.sku)||"",
    price:parseFloat($("#epVp"+i)?.value)||0,
    mrp:  parseFloat($("#epVm"+i)?.value)||0,
    stock:Math.max(0,parseInt($("#epVk"+i)?.value)||0),
    amazonUrl:(($("#epVa"+i)?.value) ?? v.amazonUrl ?? "")||"",
    _new: v._new
  }));
}
function epVarListHTML(){
  const cols='1.1fr 1.2fr .8fr .8fr .7fr 28px';
  const head=`<div style="display:grid;grid-template-columns:${cols};gap:.4rem;font-size:.64rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:.3rem"><div>Label</div><div>SKU</div><div>Price ₹</div><div>MRP ₹</div><div>Stock</div><div></div></div>`;
  const rows=_editVariants.map((v,i)=>`<div style="display:grid;grid-template-columns:${cols};gap:.4rem;align-items:center;margin-bottom:.3rem">
    <input id="epVl${i}" value="${escapeHtml(v.label)}" placeholder="250 ml" aria-label="Variant label">
    <input id="epVs${i}" value="${escapeHtml(v.sku)}" placeholder="SDL-XXX" ${v._new?'':'readonly title="SKU is fixed once created (it links stock &amp; orders)"'} aria-label="SKU">
    <input id="epVp${i}" type="number" min="0" step="1" value="${v.price}" aria-label="Price">
    <input id="epVm${i}" type="number" min="0" step="1" value="${v.mrp}" aria-label="MRP">
    <input id="epVk${i}" type="number" min="0" step="1" value="${v.stock}" aria-label="Stock">
    <button class="ra del" onclick="epVarRemove(${i})" title="Remove variant" aria-label="Remove">×</button>
  </div>
  <div style="display:flex;align-items:center;gap:.45rem;margin:0 0 .7rem;padding-bottom:.7rem;border-bottom:1px solid var(--line)">
    <span style="font-size:.62rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);white-space:nowrap">Amazon</span>
    <input id="epVa${i}" value="${escapeHtml(v.amazonUrl||'')}" placeholder="https://www.amazon.in/dp/… — link for this size (optional)" style="flex:1;font-size:.8rem" aria-label="Amazon link for ${escapeHtml(v.label||'this variation')}">
  </div>`).join('');
  return head+rows;
}
function epVarRender(){const el=$("#epVarList");if(el)el.innerHTML=epVarListHTML();}
function epVarAdd(){ epVarSync(); _editVariants.push({label:'',sku:'',price:0,mrp:0,stock:0,amazonUrl:'',_new:true}); epVarRender(); }
function epVarRemove(i){
  epVarSync();
  if(_editVariants.length<=1){ toast("A product needs at least one variant"); return; }
  _editVariants.splice(i,1); epVarRender();
}
function openProductEditor(id){
  const p=PRODUCTS.find(x=>x.id===id); if(!p)return;
  _editFaqs=JSON.parse(JSON.stringify(p.faqs||[]));
  _editVariants=(p.variants||[]).map(v=>({label:v.label,sku:v.sku,price:v.price,mrp:v.mrp,stock:v.stock,amazonUrl:v.amazonUrl||'',_new:false}));
  _editImages=Array.isArray(p.imageUrls)?p.imageUrls.slice():[];
  $("#modalRoot").innerHTML=`<div class="modal-bg" onclick="closeModal()"></div>
   <div class="modal-card" role="dialog" aria-modal="true" style="max-width:620px"><div class="modal-head"><h3>Edit · ${escapeHtml(p.name)}</h3><button class="x" onclick="closeModal()">×</button></div>
   <div class="modal-body">
     <div class="field"><label>Name</label><input id="epName" value="${escapeHtml(p.name)}"></div>
     <div class="field row2"><div><label>Category</label><select id="epCat">${CATEGORIES.map(c=>`<option ${p.cat===c.name?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select></div><div><label>GST %</label><input id="epGst" type="number" value="${p.gst}"></div></div>
     <div class="field"><label>Description</label><textarea id="epDesc" rows="3">${escapeHtml(p.desc||'')}</textarea></div>
     <div class="field"><label style="display:block;margin-bottom:.5rem">Product images (first = main; shown on cards &amp; product page)</label>
       <div id="epImgList">${epImgListHTML()}</div>
       <input type="file" accept="image/png,image/jpeg,image/webp" onchange="epImgAdd(this)">
     </div>
     <div class="field"><label style="display:block;margin-bottom:.5rem">Variations — pricing &amp; stock (add, edit or remove)</label>
       <div id="epVarList">${epVarListHTML()}</div>
       <button class="btn-sm" onclick="epVarAdd()" style="margin-top:.2rem">＋ Add variation</button>
       ${BACKEND?'<p style="font-size:.74rem;color:var(--muted);margin-top:.4rem">New variations start at the stock you type here; then receive batches for them via 📦 Batches. Existing SKUs can\'t be changed (they link stock &amp; orders). Removing a variation deletes it.</p>':''}
     </div>
     <div class="field row2"><div><label>SEO title</label><input id="epSeo" value="${escapeHtml(p.seoTitle||p.name)}"></div><div><label>HSN code</label><input id="epHsn" value="${escapeHtml(p.hsn||'')}" placeholder="e.g. 1517"></div></div>
     <div class="field row2">
       <div><label>Low-stock alert at or below (units)</label><input id="epLow" type="number" min="0" step="1" value="${lowThreshold(p)}"><small style="font-size:.72rem;color:var(--muted)">Flags “Low” on the card, Inventory &amp; Dashboard. 0 = never warn.</small></div>
       <div><label>Per-product shipping surcharge (₹)</label><input id="epShip" type="number" min="0" value="${p.shipFee||0}"><small style="font-size:.72rem;color:var(--muted)">Added when the basket is below the free-shipping threshold.</small></div>
     </div>
     <div class="field"><label>Buy-on-Amazon URL — fallback for all variations</label><input id="epAmazon" value="${escapeHtml(p.amazonUrl||'')}" placeholder="https://www.amazon.in/dp/…"><small style="font-size:.72rem;color:var(--muted)">Used for any variation without its own Amazon link above. Blank here and above hides the button.</small></div>
     <div class="field"><label>Lab report link (Google Drive / PDF — public link)</label><input id="epLab" value="${escapeHtml((p.content&&p.content.labUrl)||'')}" placeholder="https://drive.google.com/…"></div>
     <div class="field"><label style="display:block;margin-bottom:.5rem">FAQs (shown on the product page)</label>
       <div id="epFaqList">${epFaqListHTML()}</div>
       <button class="btn-sm" onclick="epFaqAdd()">＋ Add question</button>
     </div>
     <div style="display:flex;align-items:center;gap:.6rem;margin:1rem 0 1rem"><div class="tog ${p.draft?'':'on'}" id="epPub" onclick="this.classList.toggle('on')"></div><span style="font-size:.86rem">Published (off = draft)</span></div>
     <button class="btn-sm primary" onclick="saveProductEdit(${id})">Save changes</button>
   </div></div>`;
  $("#modalRoot").classList.add("show");
}
function saveProductEdit(id){
  const p=PRODUCTS.find(x=>x.id===id); if(!p)return;
  p.name=$("#epName").value.trim()||p.name; p.cat=$("#epCat").value; p.gst=parseInt($("#epGst").value)||0;
  p.desc=$("#epDesc").value; p.seoTitle=$("#epSeo").value; p.hsn=$("#epHsn").value;
  p.shipFee=Math.max(0,parseInt($("#epShip").value)||0);          // client #3
  p.lowStock=Math.max(0,parseInt($("#epLow").value)||0);          // per-product low-stock alert
  p.amazonUrl=($("#epAmazon").value||"").trim();                   // client #12
  p.content=p.content||{}; p.content.labUrl=($("#epLab").value||"").trim(); // client #9
  epFaqSync(); p.faqs=_editFaqs.map(f=>({q:(f.q||"").trim(),a:(f.a||"").trim()})).filter(f=>f.q&&f.a); // client #9 FAQ manager
  p.imageUrls=_editImages.slice();   // Phase 4.4 uploaded images
  // variations — add / edit / remove
  epVarSync();
  const seen=new Set();
  const vs=_editVariants.map(v=>({
    label:(v.label||"").trim(),
    sku:(v.sku||"").trim().toUpperCase(),
    price:Math.max(0,+v.price||0), mrp:Math.max(0,+v.mrp||0), stock:Math.max(0,parseInt(v.stock)||0),
    amazonUrl:(v.amazonUrl||"").trim()
  })).filter(v=>{
    if(!v.label||!v.sku) return false;         // drop incomplete rows
    if(seen.has(v.sku)) return false;          // drop duplicate SKUs
    seen.add(v.sku); return true;
  });
  if(!vs.length){ toast("Add at least one complete variation (label + SKU)"); return; }
  p.variants=vs;
  p.draft=!$("#epPub").classList.contains('on');
  syncProductFromVariants(p); adminSync('product.upsert',{product:p}); logAudit("product.edit",p.sku,p.name); persistAll(); closeModal(); renderAdminTab(); renderProducts&&renderProducts(); toast("Product saved");
}
/* Archive = unpublish. Audit BUG-05: this used to remove the product from the local
   list AND hard-delete the row server-side, cascading through product_variants into
   inventory_batches — destroying the batch/expiry ledger the dialog promised to keep.
   It now sets draft=true on both sides, so the product leaves the storefront, stays
   in the admin list, and can be republished. */
function deleteProduct(id){
  const p=PRODUCTS.find(x=>x.id===id); if(!p)return;
  if(p.draft){ toast("Already unpublished"); return; }
  const openOrders=ORDERS.filter(o=>['payment-pending','paid','processing','packed','shipped','out-for-delivery'].includes(o.status)&&o.lines.some(l=>l.name===p.name));
  if(openOrders.length){ if(!confirm(`"${p.name}" is on ${openOrders.length} open order(s). Archiving only hides it from the storefront — those orders, and its stock batches, are untouched. Continue?`)) return; }
  else { if(!confirm(`Archive "${p.name}"? It will be hidden from the storefront. Its stock batches are kept and you can republish it from the product editor at any time.`)) return; }
  p.draft=true;   // mirror the server: unpublish, don't remove
  adminSync('product.delete',{id});
  logAudit("product.archive",p.sku,p.name); persistAll(); renderAdmin(); renderProducts&&renderProducts(); toast("Product archived — hidden from the storefront");
}
function cloneProduct(id){
  const p=PRODUCTS.find(x=>x.id===id); const copy=JSON.parse(JSON.stringify(p));
  copy.id=Date.now();copy.name=p.name+" (Copy)";copy.sku=p.sku+"-C";copy.tag="";copy.draft=true;(copy.variants||[]).forEach(v=>v.sku=v.sku+"-C");
  PRODUCTS.push(copy);syncProductFromVariants(copy);adminSync('product.upsert',{product:copy});logAudit("product.clone",copy.sku,"from "+p.sku);persistAll();renderAdmin();renderProducts&&renderProducts();toast("Product cloned as draft");
}

/* ---------------- ADD PRODUCT (audit P1 #6) ---------------- */
function renderAddProduct(m){
  m.innerHTML=`<h1>Add Product</h1><p class="admin-sub">Create a SKU with variant pricing, tax class and publish state.</p>
  <div class="admin-panel"><div class="panel-head"><h3>New Product</h3></div><div style="padding:1.5rem">
    <div class="field row2"><div><label>Product Name</label><input id="npName" placeholder="e.g. A2 Cow Ghee"></div><div><label>Category</label>
      <select id="npCat">${CATEGORIES.map(c=>`<option>${escapeHtml(c.name)}</option>`).join('')}</select></div></div>
    <div class="field row2"><div><label>Price (₹)</label><input id="npPrice" type="number" placeholder="899"></div><div><label>MRP (₹)</label><input id="npMrp" type="number" placeholder="1150"></div></div>
    <div class="field row2"><div><label>Stock Qty</label><input id="npStock" type="number" min="0" step="1" placeholder="50"></div><div><label>SKU</label><input id="npSku" placeholder="SDL-XXX"></div></div>
    <div class="field row2"><div><label>GST %</label><input id="npGst" type="number" placeholder="5"></div><div><label>HSN code</label><input id="npHsn" placeholder="1517"></div></div>
    <div class="field row2"><div><label>Low-stock alert at or below (units)</label><input id="npLow" type="number" min="0" step="1" value="10" placeholder="10"></div><div></div></div>
    <div class="field"><label>Description</label><textarea id="npDesc" rows="2" placeholder="Short product description…"></textarea></div>
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:1rem"><div class="tog" id="npPub" onclick="this.classList.toggle('on')"></div><span style="font-size:.86rem">Publish immediately (off = save as draft)</span></div>
    <button class="btn btn-primary" onclick="addProduct()">Create Product</button>
  </div></div>`;
}
function addProduct(){
  const name=$("#npName").value.trim();if(!name){toast("Product name required");return;}
  const price=parseInt($("#npPrice").value)||0,mrp=parseInt($("#npMrp").value)||price;
  const sku=$("#npSku").value||"SDL-NEW-"+Date.now();
  const stock=parseInt($("#npStock").value)||0;
  const np={id:Date.now(),name,cat:$("#npCat").value,rating:5,reviews:0,sku,tag:"New",type:"jar",c1:"#1f3520",c2:"#c9a85e",
    gst:parseInt($("#npGst").value)||5, hsn:$("#npHsn").value||"", draft:!$("#npPub").classList.contains('on'),
    lowStock:Math.max(0,parseInt($("#npLow")?.value ?? 10)||0),
    desc:$("#npDesc").value||"New Suddhalaya product.",feats:["Lab-tested","Small-batch"],
    variants:[{label:"Standard",sku,price,mrp,stock}],
    content:{origin:"—",ingredients:"—",usage:"—",certifications:"FSSAI licensed",shelfLife:"—",netWeight:"Standard"},faqs:[]};
  syncProductFromVariants(np);PRODUCTS.push(np);
  adminSync('product.upsert',{product:np});
  logAudit("product.create",sku,name+(np.draft?" (draft)":" (published)"));
  persistAll();
  toast("Product created"+(np.draft?" as draft":" — live on store"));adminGo('inventory');
}

/* ---------------- CATEGORIES (audit P1 #5) ---------------- */
function renderCategories(m){
  m.innerHTML=`<h1>Categories</h1><p class="admin-sub">First-class categories with slugs and SEO, driving storefront navigation.</p>
  <div class="tool-row"><button class="btn-sm primary" onclick="addCategory()">＋ Add category</button><div class="spacer"></div></div>
  <div class="admin-panel"><div class="panel-head"><h3>${CATEGORIES.length} categories</h3></div>
  <table><thead><tr><th>Name</th><th>Slug</th><th>SEO description</th><th>Products</th><th>Actions</th></tr></thead><tbody>
  ${CATEGORIES.map(c=>`<tr>
    <td><div style="display:flex;align-items:center;gap:.6rem">${(c.image||catImg(c.name))?`<img src="${c.image||catImg(c.name)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--line);flex:none">`:'<span style="width:40px;height:40px;border-radius:6px;border:1px dashed var(--line);flex:none;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:.9rem">🖼️</span>'}<b>${escapeHtml(c.name)}</b></div></td><td style="color:var(--muted)">${escapeHtml(c.slug)}</td><td>${escapeHtml(c.seo)}</td>
    <td>${PRODUCTS.filter(p=>p.cat===c.name).length}</td>
    <td><div class="row-actions"><button class="btn-sm" onclick="editCategory(${c.id})">Edit</button><button class="ra del" onclick="deleteCategory(${c.id})" title="Delete">🗑</button></div></td>
  </tr>`).join('')}
  </tbody></table></div>`;
}
/* Client QA r2 (admin PDF #4): full category editor — name, slug AND SEO are all
   editable in a proper modal (the old prompt() only let you change the SEO text). */
let _editCatId=null;
let _editCatImg='';   // uploaded category image URL (or data-URL offline) for the editor
function catSlugify(s){return (s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
function catImgBoxHTML(){
  if(!_editCatImg) return '<p style="color:var(--muted);font-size:.82rem;margin:.2rem 0 .5rem">No image yet — the storefront tile uses a default photo.</p>';
  return `<div style="position:relative;width:130px;height:88px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--cream-deep);margin:.2rem 0 .5rem"><img src="${_editCatImg}" alt="" style="width:100%;height:100%;object-fit:cover"><button type="button" onclick="catImgRemove()" title="Remove" style="position:absolute;top:3px;right:3px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:20px;height:20px;line-height:1;cursor:pointer;font-size:.8rem">×</button></div>`;
}
function catImgRender(){const el=$("#catImgBox");if(el)el.innerHTML=catImgBoxHTML();}
function catImgRemove(){_editCatImg='';catImgRender();}
async function catImgAdd(input){
  const f=input.files&&input.files[0]; if(!f)return;
  if(f.size>5*1024*1024){toast("Image too large — max 5 MB");input.value="";return;}
  const dataUrl=await new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.readAsDataURL(f);});
  input.value="";
  if(BACKEND){
    toast("Uploading…");
    const r=await SDBA.upload(dataUrl, f.name);
    if(!r||!r.ok){toast((r&&r.err)||"Upload failed");return;}
    _editCatImg=r.url;
  } else { _editCatImg=dataUrl; }   // offline: keep the data URL inline
  catImgRender();
}
function addCategory(){ openCategoryEditor(null); }
function editCategory(id){ openCategoryEditor(id); }
function openCategoryEditor(id){
  const c = id ? CATEGORIES.find(x=>x.id===id) : {name:'',slug:'',seo:''};
  if(id && !c) return;
  _editCatId=id;
  // Pre-fill with the image currently shown on the storefront (uploaded image, else
  // the built-in category photo) so existing category images are linked into the
  // editor and become explicit/managed the moment you Save.
  _editCatImg=(c&&(c.image||catImg(c.name)))||'';
  $("#modalRoot").innerHTML=`<div class="modal-bg" onclick="closeModal()"></div>
   <div class="modal-card" role="dialog" aria-modal="true" style="max-width:520px"><div class="modal-head"><h3>${id?'Edit category':'Add category'}</h3><button class="x" aria-label="Close" onclick="closeModal()">×</button></div>
   <div class="modal-body">
     <div class="field"><label for="catName">Category name *</label><input id="catName" value="${escapeHtml(c.name||'')}" placeholder="A2 Dairy" oninput="catSlugSync()"></div>
     <div class="field"><label for="catSlug">URL slug</label><input id="catSlug" value="${escapeHtml(c.slug||'')}" placeholder="a2-dairy"><small style="font-size:.72rem;color:var(--muted)">Used in storefront navigation &amp; links — lowercase, hyphenated.</small></div>
     <div class="field"><label for="catSeo">SEO description</label><textarea id="catSeo" rows="3" placeholder="Short description shown to search engines">${escapeHtml(c.seo||'')}</textarea></div>
     <div class="field"><label>Category image</label>
       <div id="catImgBox">${catImgBoxHTML()}</div>
       <input type="file" accept="image/png,image/jpeg,image/webp" id="catImgFile" onchange="catImgAdd(this)" style="font-size:.82rem">
       <small style="font-size:.72rem;color:var(--muted)">Shown on the storefront “Shop by Category” tile. JPG/PNG/WebP, max 5&nbsp;MB.</small>
     </div>
     <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="saveCategoryEdit()">${id?'Save changes':'Add category'}</button>
   </div></div>`;
  $("#modalRoot").classList.add('show');
  setTimeout(()=>$("#catName")?.focus(),30);
}
function catSlugSync(){ // auto-fill slug only while creating (never clobber an existing slug)
  if(_editCatId) return;
  const n=$("#catName"),s=$("#catSlug"); if(n&&s) s.value=catSlugify(n.value);
}
async function saveCategoryEdit(){
  const name=($("#catName")?.value||'').trim();
  if(!name){toast("Category name is required");return;}
  const slug=catSlugify($("#catSlug")?.value||'')||catSlugify(name);
  const seo=($("#catSeo")?.value||'').trim();
  const editing=!!_editCatId;
  const btn=$("#modalRoot .btn-primary"); setBtnLoading(btn,true,editing?'Saving…':'Adding…');
  try{
    if(editing){
      const c=CATEGORIES.find(x=>x.id===_editCatId); if(!c)return;
      if(CATEGORIES.some(x=>x.id!==c.id && (x.slug===slug || x.name.toLowerCase()===name.toLowerCase()))){toast("Another category already uses that name or slug");return;}
      const oldName=c.name;
      c.name=name; c.slug=slug; c.seo=seo; c.image=_editCatImg||null;
      // Update by DB id (matchId) so renaming the slug edits this row, not a dup.
      const r=await adminSync('category.upsert',{category:c, matchId:c.id});
      if(r&&r.ok===false){ toast('Could not save category — '+((r&&r.err)||'try again')); return; }
      // keep products linked if the category was renamed
      if(oldName!==name){ for(const p of PRODUCTS){ if(p.cat===oldName){ p.cat=name; await adminSync('product.upsert',{product:p}); } } }
      logAudit("category.edit",c.slug,name);
    } else {
      if(CATEGORIES.some(x=>x.slug===slug || x.name.toLowerCase()===name.toLowerCase())){toast("A category with that name or slug already exists");return;}
      const c={id:Date.now(),name,slug,seo,image:_editCatImg||null,order:CATEGORIES.length+1};
      CATEGORIES.push(c);
      const r=await adminSync('category.upsert',{category:c});
      if(r&&r.ok===false){ CATEGORIES=CATEGORIES.filter(x=>x!==c); toast('Could not add category — '+((r&&r.err)||'try again')); renderAdminTab(); return; }
      if(r&&r.id!=null) c.id=r.id;   // adopt the real DB id so later edit/delete match the row
      logAudit("category.create",c.slug,name);
    }
    persistAll(); closeModal(); renderAdminTab(); renderProducts&&renderProducts(); renderFilters&&renderFilters(); renderCategoryTiles&&renderCategoryTiles();
    toast(editing?"Category updated":"Category added");
  } finally { setBtnLoading(btn,false); }
}
async function deleteCategory(id){
  const c=CATEGORIES.find(x=>x.id===id); if(!c)return;
  const count=PRODUCTS.filter(p=>p.cat===c.name).length;
  if(count){toast(`Cannot delete — ${count} product(s) use this category`);return;}
  if(!confirm(`Delete category "${c.name}"?`))return;
  const r=await adminSync('category.delete',{slug:c.slug});   // slug delete is id-agnostic (safe for unsynced rows)
  if(r&&r.ok===false){ toast('Could not delete category — '+((r&&r.err)||'try again')); return; }
  CATEGORIES=CATEGORIES.filter(x=>x.id!==id);logAudit("category.delete",c.slug,c.name);persistAll();renderAdminTab();renderCategoryTiles&&renderCategoryTiles();toast("Category deleted");
}

/* ---------------- CUSTOMERS (audit P1 #4) ---------------- */
let custSearch="";
function setCustSearch(v){custSearch=v.toLowerCase();renderCustomers($("#adminMain"));}
function renderCustomers(m){
  let list=CUSTOMERS.filter(c=>c.name.toLowerCase().includes(custSearch)||c.email.toLowerCase().includes(custSearch)||(c.city||'').toLowerCase().includes(custSearch));
  m.innerHTML=`<h1>Customers</h1><p class="admin-sub">Profiles, order history and lifetime value — every order links to a customer record.</p>
  <div class="tool-row"><input class="admin-search" placeholder="Search customers…" oninput="setCustSearch(this.value)" value="${escapeHtml(custSearch)}"><div class="spacer"></div></div>
  <div class="admin-panel"><div class="panel-head"><h3>${list.length} customers</h3></div>
  <table><thead><tr><th>Customer</th><th>Contact</th><th>City</th><th>Orders</th><th>Lifetime value</th><th>Tags</th></tr></thead><tbody>
  ${list.map(c=>{const orders=ORDERS.filter(o=>o.customerId===c.id||o.email===c.email);const clv=orders.reduce((s,o)=>s+o.total,0);return `<tr style="cursor:pointer" onclick="openCustomer(${c.id})">
    <td><b>${escapeHtml(c.name)}</b><br><small style="color:var(--muted)">since ${c.since}</small></td>
    <td style="font-size:.82rem">${escapeHtml(c.email)}<br>${c.phone||''}</td>
    <td>${escapeHtml(c.city||'—')}</td><td>${orders.length}</td><td>${fmt(clv)}</td>
    <td>${(c.tags||[]).map(t=>`<span class="tag-pill">${escapeHtml(t)}</span>`).join('')||'—'}</td>
  </tr>`;}).join('')}
  </tbody></table></div>`;
}
function openCustomer(id){
  const c=CUSTOMERS.find(x=>x.id===id); if(!c)return;
  const orders=ORDERS.filter(o=>o.customerId===c.id||o.email===c.email);
  $("#modalRoot").innerHTML=`<div class="modal-bg" onclick="closeModal()"></div>
   <div class="modal-card" role="dialog" aria-modal="true" style="max-width:560px"><div class="modal-head"><h3>${escapeHtml(c.name)}</h3><button class="x" onclick="closeModal()">×</button></div>
   <div class="modal-body">
     <div class="kv"><span>Email</span><span>${escapeHtml(c.email)}</span></div>
     <div class="kv"><span>Phone</span><span>${c.phone||'—'}</span></div>
     <div class="kv"><span>City</span><span>${escapeHtml(c.city||'—')}</span></div>
     <div class="kv"><span>Customer since</span><span>${c.since}</span></div>
     <div class="kv"><span>Lifetime value</span><span><b>${fmt(orders.reduce((s,o)=>s+o.total,0))}</b></span></div>
     <h4 style="margin:1rem 0 .5rem;font-size:.95rem">Order history (${orders.length})</h4>
     ${orders.length?orders.map(o=>`<div class="kv"><span><b>${o.id}</b> · ${o.date}</span><span><span class="badge ${o.status}">${o.status}</span> ${fmt(o.total)}</span></div>`).join(''):'<p style="color:var(--muted);font-size:.85rem">No orders yet.</p>'}
   </div></div>`;
  $("#modalRoot").classList.add("show");
}

/* ---------------- PAYMENTS (audit P0 #6 / §7.7) ---------------- */
let payFilter="all";
function setPayFilter(v){payFilter=v;renderAdminTab();}
function renderPayments(m){
  const paid=ORDERS.filter(o=>o.payment.status==='paid');
  const pending=ORDERS.filter(o=>o.payment.status==='pending');
  const list=payFilter==="all"?ORDERS:ORDERS.filter(o=>o.payment&&o.payment.status===payFilter);
  m.innerHTML=`<h1>Payments</h1><p class="admin-sub">Transaction status, capture state and reconciliation against orders.</p>
  <div class="simnote">Demo reconciliation. In production this is backed by server-side Razorpay/Cashfree webhooks with signature verification — a client must never self-report "paid".</div>
  <div class="stat-row">
    <div class="stat"><div class="sl">Captured</div><b>${fmt(paid.reduce((s,o)=>s+o.total,0))}</b><div class="delta">${paid.length} txns</div></div>
    <div class="stat"><div class="sl">Awaiting capture</div><b>${fmt(pending.reduce((s,o)=>s+o.total,0))}</b><div class="delta ${pending.length?'down':''}">${pending.length} pending</div></div>
    <div class="stat"><div class="sl">Refunded</div><b>${fmt(ORDERS.filter(o=>o.payment.status==='refunded').reduce((s,o)=>s+o.total,0))}</b><div class="delta">${ORDERS.filter(o=>o.payment.status==='refunded').length} refunds</div></div>
    <div class="stat"><div class="sl">Gateways</div><b style="font-size:1.2rem">Razorpay</b><div class="delta">+ COD</div></div>
  </div>
  <div class="tool-row">
    <select class="adm-select" onchange="setPayFilter(this.value)">
      <option value="all" ${payFilter==='all'?'selected':''}>All payments</option>
      <option value="pending" ${payFilter==='pending'?'selected':''}>Awaiting capture</option>
      <option value="paid" ${payFilter==='paid'?'selected':''}>Captured</option>
      <option value="refunded" ${payFilter==='refunded'?'selected':''}>Refunded</option>
    </select>
    <div class="spacer"></div>
  </div>
  <div class="admin-panel"><div class="panel-head"><h3>Transactions${payFilter!=='all'?` · ${list.length} ${payFilter}`:''}</h3><button class="btn-sm" onclick="exportOrdersCSV()">⭳ Reconciliation CSV</button></div>
  <table><thead><tr><th>Order</th><th>Txn ID</th><th>Method</th><th>Gateway</th><th>Amount</th><th>Status</th><th>Captured</th><th></th></tr></thead><tbody>
  ${list.length?list.map(o=>`<tr>
    <td><b>${o.id}</b></td><td style="font-size:.78rem;color:var(--muted)">${o.payment.txnId||'—'}</td>
    <td>${o.payment.method.toUpperCase()}</td><td>${o.payment.gateway||'—'}</td><td>${fmt(o.total)}</td>
    <td><span class="badge ${o.payment.status}">${o.payment.status}</span></td><td style="font-size:.78rem;color:var(--muted)">${o.payment.capturedAt||'—'}</td>
    <td>${o.payment.status==='pending'?`<button class="btn-sm primary" onclick="capturePayment('${o.id}')">Capture</button>`:''}</td>
  </tr>`).join(''):`<tr><td colspan="8"><div class="empty-state"><div class="ic">₹</div>No ${payFilter==='all'?'':payFilter+' '}transactions.</div></td></tr>`}
  </tbody></table></div>`;
}

/* ---------------- COUPONS (audit P1 #7) ---------------- */
function renderCoupons(m){
  const codes=Object.keys(COUPONS);
  m.innerHTML=`<h1>Coupons & Promotions</h1><p class="admin-sub">Create and manage discount codes with caps, expiry and usage analytics.</p>
  <div class="tool-row"><button class="btn-sm primary" onclick="couponForm(0)">＋ New coupon</button><div class="spacer"></div></div>
  <div class="admin-panel"><div class="panel-head"><h3>${codes.length} coupons</h3></div>
  <table><thead><tr><th>Code</th><th>Discount</th><th>Scope</th><th>Min cart</th><th>Used</th><th>Cap</th><th>Expires</th><th>Active</th><th>Actions</th></tr></thead><tbody>
  ${codes.map(code=>{const c=COUPONS[code];return `<tr>
    <td><b>${code}</b></td><td>${c.type==='pct'?c.value+'%':fmt(c.value)} off</td><td>${couponScopeBadge(c)}</td><td>${c.minCart?fmt(c.minCart):'—'}</td>
    <td>${c.uses||0}</td><td>${c.cap?c.cap:'∞'}</td><td style="color:var(--muted)">${c.expires||'—'}</td>
    <td><div class="tog ${c.active?'on':''}" onclick="toggleCoupon('${code}')"></div></td>
    <td><div class="row-actions"><button class="btn-sm" onclick="couponForm('${code}')">Edit</button><button class="ra del" onclick="deleteCoupon('${code}')" title="Delete">🗑</button></div></td>
  </tr>`;}).join('')}
  </tbody></table></div>`;
}
function couponScopeBadge(c){
  const s=c.scope||'all';
  if(s==='products') return '<span class="badge low">Products</span>';
  if(s==='users') return '<span class="badge" style="background:#dcd2ef;color:#5b3fa0">Users</span>';
  if(s==='user_products') return '<span class="badge" style="background:#dcd2ef;color:#5b3fa0">Users+Products</span>';
  return '<span class="badge in">Public</span>';
}
/* Scope-aware coupon editor (Phase 4.2) */
function couponForm(code){
  const c = code ? COUPONS[code] : {type:'pct',value:10,desc:'',active:true,cap:0,minCart:0,expires:'31 Dec 2026',scope:'all',productSkus:[],userEmails:[],perUserLimit:0};
  if(!c) return;
  const scope=c.scope||'all';
  const prodChecks=PRODUCTS.map(p=>{const skus=(p.variants||[]).map(v=>v.sku); const on=(c.productSkus||[]).some(s=>skus.includes(s));
    return `<label style="display:flex;align-items:center;gap:.5rem;font-size:.82rem;cursor:pointer;line-height:1.25"><input type="checkbox" class="cpProd" value="${skus.join(',')}" ${on?'checked':''} style="width:16px;height:16px;flex:0 0 auto;margin:0;padding:0"> <span>${escapeHtml(p.name)}</span></label>`;}).join('');
  $("#modalRoot").innerHTML=`<div class="modal-bg" onclick="closeModal()"></div>
   <div class="modal-card" role="dialog" aria-modal="true" style="max-width:560px"><div class="modal-head"><h3>${code?'Edit':'New'} coupon</h3><button class="x" onclick="closeModal()">×</button></div>
   <div class="modal-body">
     <div class="field row2"><div><label>Code</label><input id="cpCode" value="${code||''}" ${code?'readonly':''} placeholder="SUMMER20"></div><div><label>Type</label><select id="cpType"><option value="pct" ${c.type==='pct'?'selected':''}>Percentage %</option><option value="flat" ${c.type==='flat'?'selected':''}>Flat ₹</option></select></div></div>
     <div class="field row2"><div><label>Value</label><input id="cpValue" type="number" min="0" value="${c.value}"></div><div><label>Min cart (₹)</label><input id="cpMin" type="number" min="0" value="${c.minCart||0}"></div></div>
     <div class="field row2"><div><label>Usage cap (0 = ∞)</label><input id="cpCap" type="number" min="0" value="${c.cap||0}"></div><div><label>Per-user limit (0 = ∞)</label><input id="cpPerUser" type="number" min="0" value="${c.perUserLimit||0}"></div></div>
     <div class="field"><label>Description</label><input id="cpDesc" value="${escapeHtml(c.desc||'')}" placeholder="10% off"></div>
     <div class="field"><label>Scope</label><select id="cpScope" onchange="couponScopeToggle()">
       <option value="all" ${scope==='all'?'selected':''}>Public — anyone, whole cart</option>
       <option value="products" ${scope==='products'?'selected':''}>Specific products only</option>
       <option value="users" ${scope==='users'?'selected':''}>Specific users only</option>
       <option value="user_products" ${scope==='user_products'?'selected':''}>Specific users + products</option>
     </select></div>
     <div class="field" id="cpProdWrap" style="display:${scope==='products'||scope==='user_products'?'block':'none'}"><label>Eligible products (discount applies to these only)</label>
       <div style="max-height:150px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:.6rem;display:grid;grid-template-columns:1fr 1fr;gap:.3rem">${prodChecks}</div></div>
     <div class="field" id="cpUserWrap" style="display:${scope==='users'||scope==='user_products'?'block':'none'}"><label>Allowed emails (one per line)</label>
       <textarea id="cpEmails" rows="3" placeholder="a@email.com&#10;b@email.com">${(c.userEmails||[]).join('\n')}</textarea></div>
     <button class="btn-sm primary" onclick="saveCoupon('${code||''}')">Save coupon</button>
   </div></div>`;
  $("#modalRoot").classList.add("show");
}
function couponScopeToggle(){
  const s=$("#cpScope").value;
  $("#cpProdWrap").style.display=(s==='products'||s==='user_products')?'block':'none';
  $("#cpUserWrap").style.display=(s==='users'||s==='user_products')?'block':'none';
}
function saveCoupon(existing){
  const code=(existing||$("#cpCode").value||'').trim().toUpperCase(); if(!code){toast("Code required");return;}
  if(!existing && COUPONS[code]){toast("Code already exists");return;}
  const type=$("#cpType").value, value=parseFloat($("#cpValue").value)||0; if(value<=0){toast("Enter a value");return;}
  const scope=$("#cpScope").value;
  const productSkus=(scope==='products'||scope==='user_products') ? [...document.querySelectorAll('.cpProd:checked')].flatMap(el=>el.value.split(',')) : [];
  const userEmails=(scope==='users'||scope==='user_products') ? ($("#cpEmails").value||'').split(/\n+/).map(e=>e.trim().toLowerCase()).filter(Boolean) : [];
  const prev=COUPONS[code]||{};
  COUPONS[code]={type,value,desc:$("#cpDesc").value.trim()||(type==='pct'?value+'% off':'₹'+value+' off'),active:existing?prev.active:true,uses:prev.uses||0,
    cap:parseInt($("#cpCap").value)||0,minCart:parseFloat($("#cpMin").value)||0,expires:prev.expires||"31 Dec 2026",
    scope,productSkus,userEmails,perUserLimit:parseInt($("#cpPerUser").value)||0};
  adminSync('coupon.upsert',{coupon:{code,...COUPONS[code]}});
  logAudit(existing?"coupon.edit":"coupon.create",code,scope);persistAll();closeModal();renderAdminTab();toast("Coupon saved");
}
function toggleCoupon(code){COUPONS[code].active=!COUPONS[code].active;adminSync('coupon.toggle',{code});logAudit("coupon.toggle",code,COUPONS[code].active?"active":"disabled");persistAll();renderAdminTab();}
function deleteCoupon(code){if(!confirm("Delete coupon "+code+"?"))return;delete COUPONS[code];adminSync('coupon.delete',{code});logAudit("coupon.delete",code,"");persistAll();renderAdminTab();toast("Coupon deleted");}

/* ---------------- REPORTS (audit P1 #8 / §7.14) ---------------- */
function renderReports(m){
  // best sellers from line items
  const skuMap={};
  ORDERS.forEach(o=>o.lines.forEach(l=>{skuMap[l.name]=(skuMap[l.name]||0)+l.qty;}));
  const best=Object.entries(skuMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
  // revenue by day
  const dayMap={};
  ORDERS.filter(o=>o.payment.status==='paid').forEach(o=>{dayMap[o.date]=(dayMap[o.date]||0)+o.total;});
  const days=Object.entries(dayMap).slice(0,6).reverse();
  const maxDay=Math.max(1,...days.map(d=>d[1]));
  // tax collected
  const taxTotal=round2(ORDERS.filter(o=>o.payment.status==='paid').reduce((s,o)=>s+orderTaxTotal(o),0));
  m.innerHTML=`<h1>Reports & Analytics</h1><p class="admin-sub">Real aggregates from order, payment and line-item data — exportable.</p>
  <div class="stat-row">
    <div class="stat"><div class="sl">Paid revenue</div><b>${fmt(paidRevenue())}</b></div>
    <div class="stat"><div class="sl">Avg order value</div><b>${fmt(ORDERS.length?ORDERS.reduce((s,o)=>s+o.total,0)/ORDERS.length:0)}</b></div>
    <div class="stat"><div class="sl">GST collected</div><b>${fmt(taxTotal)}</b></div>
    <div class="stat"><div class="sl">Units sold</div><b>${Object.values(skuMap).reduce((a,b)=>a+b,0)}</b></div>
  </div>
  <div class="detail-grid">
    <div class="dcard"><div class="dh">Revenue by day (paid)</div><div class="db">
      <div class="report-bars">${days.map(d=>`<div class="rb" style="height:${Math.round(d[1]/maxDay*100)}%"><b>${fmt(d[1])}</b><span>${d[0].split(' ').slice(0,2).join(' ')}</span></div>`).join('')||'<p style="color:var(--muted)">No paid orders yet.</p>'}</div>
    </div></div>
    <div class="dcard"><div class="dh">Best sellers</div><div class="db">
      ${best.map(b=>`<div style="margin-bottom:.7rem"><div style="display:flex;justify-content:space-between;font-size:.85rem"><span>${escapeHtml(b[0])}</span><b>${b[1]} units</b></div><div class="mini-bar"><span style="width:${Math.round(b[1]/best[0][1]*100)}%"></span></div></div>`).join('')||'<p style="color:var(--muted)">No sales yet.</p>'}
    </div></div>
  </div>
  ${trafficPanelHTML()}
  <h3 style="margin:1.6rem 0 1rem;font-size:1.1rem">Region-wise sales</h3>
  <div id="regionPanel"><p style="color:var(--muted)">Loading…</p></div>
  <div class="tool-row" style="margin-top:1.2rem"><button class="btn-sm" onclick="exportOrdersCSV()">⭳ Sales CSV</button><button class="btn-sm" onclick="exportInventoryCSV()">⭳ Inventory CSV</button></div>`;
  loadRegionReport();
}
/* Phase 4.3: region-wise sales report (state/city, date range, bars, CSV) */
let regionGroup='state', regionFrom='', regionTo='', _regionRows=[];
function regionDefaults(){
  const to=new Date(), from=new Date(Date.now()-120*86400000);
  if(!regionFrom) regionFrom=from.toISOString().slice(0,10);
  if(!regionTo) regionTo=to.toISOString().slice(0,10);
}
async function loadRegionReport(){
  regionDefaults();
  if(BACKEND){ const r=await SDBA.regionReport(regionFrom,regionTo,regionGroup); _regionRows=(r&&r.rows)?r.rows:[]; }
  else _regionRows=computeRegionOffline();
  renderRegionPanel();
}
function computeRegionOffline(){
  const from=new Date(regionFrom+'T00:00:00'), to=new Date(regionTo+'T23:59:59'); const map={};
  ORDERS.filter(o=>o.payment&&o.payment.status==='paid').forEach(o=>{
    const od=new Date(o.date); if(!isNaN(od) && (od<from||od>to)) return;   // date is 'DD Mon YYYY'
    const raw=(regionGroup==='city'?(o.ship&&o.ship.city):(o.ship&&o.ship.state))||'—';
    const reg=String(raw).trim().toUpperCase()||'—';
    const m=map[reg]||(map[reg]={region:reg,orders:0,units:0,revenue:0,discount:0});
    m.orders++; m.units+=(o.items||orderItemsCount(o)); m.revenue+=o.total||0;
  });
  return Object.values(map).map(m=>({region:m.region,orders:m.orders,units:m.units,revenue:round2(m.revenue),aov:round2(m.revenue/(m.orders||1)),discount:round2(m.discount)})).sort((a,b)=>b.revenue-a.revenue);
}
function renderRegionPanel(){
  const panel=$("#regionPanel"); if(!panel)return;
  const rows=_regionRows||[]; const maxRev=Math.max(1,...rows.map(r=>+r.revenue||0));
  panel.innerHTML=`
    <div class="tool-row">
      <button class="btn-sm ${regionGroup==='state'?'primary':''}" onclick="setRegionGroup('state')">By State</button>
      <button class="btn-sm ${regionGroup==='city'?'primary':''}" onclick="setRegionGroup('city')">By City</button>
      <div class="spacer"></div>
      <label style="font-size:.78rem;color:var(--muted)">From <input type="date" id="regFrom" value="${regionFrom}" onchange="setRegionRange()"></label>
      <label style="font-size:.78rem;color:var(--muted)">To <input type="date" id="regTo" value="${regionTo}" onchange="setRegionRange()"></label>
      <button class="btn-sm" onclick="exportRegionCSV()">⭳ CSV</button>
    </div>
    <div class="detail-grid">
      <div class="dcard"><div class="dh">Revenue by ${regionGroup}</div><div class="db">
        ${rows.length?rows.slice(0,8).map(r=>`<div style="margin-bottom:.7rem"><div style="display:flex;justify-content:space-between;font-size:.85rem"><span>${escapeHtml(r.region)}</span><b>${fmt(r.revenue)}</b></div><div class="mini-bar"><span style="width:${Math.round((+r.revenue||0)/maxRev*100)}%"></span></div></div>`).join(''):'<p style="color:var(--muted)">No paid orders in this range.</p>'}
      </div></div>
      <div class="dcard"><div class="dh">Breakdown</div><div class="db" style="overflow-x:auto">
        <table class="batch-table"><thead><tr><th>${regionGroup==='city'?'City':'State'}</th><th>Orders</th><th>Units</th><th>Revenue</th><th>AOV</th><th>Discounts</th></tr></thead><tbody>
        ${rows.length?rows.map(r=>`<tr><td><b>${escapeHtml(r.region)}</b></td><td>${r.orders}</td><td>${r.units}</td><td>${fmt(r.revenue)}</td><td>${fmt(r.aov)}</td><td>${fmt(r.discount)}</td></tr>`).join(''):'<tr><td colspan="6" style="color:var(--muted)">No data.</td></tr>'}
        </tbody></table>
      </div></div>
    </div>`;
}
function setRegionGroup(g){regionGroup=g;loadRegionReport();}
function setRegionRange(){regionFrom=$("#regFrom").value||regionFrom;regionTo=$("#regTo").value||regionTo;loadRegionReport();}
function exportRegionCSV(){
  const rows=[[regionGroup==='city'?'City':'State',"Orders","Units","Revenue","AOV","Discounts"]];
  (_regionRows||[]).forEach(r=>rows.push([r.region,r.orders,r.units,r.revenue,r.aov,r.discount]));
  downloadCSV(rows,"suddhalaya_region_"+regionGroup+".csv"); logAudit("report.region.export",regionGroup,(_regionRows||[]).length+" rows");
}
/* client #13: website traffic + engagement funnel visualization */
function analyticsLast7(){
  const days=[];
  try{
    const now=new Date();
    for(let i=6;i>=0;i--){
      const dt=new Date(now.getTime()-i*86400000).toISOString().slice(0,10);
      const d=(ANALYTICS.daily&&ANALYTICS.daily[dt])||{view:0,product:0,cart:0,order:0};
      days.push({date:dt,...{view:d.view||0,product:d.product||0,cart:d.cart||0,order:d.order||0}});
    }
  }catch(e){}
  return days;
}
function trafficPanelHTML(){
  const days=analyticsLast7();
  const sum=k=>days.reduce((s,d)=>s+(d[k]||0),0);
  const views=sum('view'),prod=sum('product'),cart=sum('cart'),ord=sum('order');
  const maxV=Math.max(1,...days.map(d=>d.view));
  const conv=views?((ord/views)*100).toFixed(1):'0.0';
  const funnel=[['Visits',views,'#1f3520'],['Product views',prod,'#4a6b3a'],['Add to cart',cart,'#a8842f'],['Orders',ord,'#6f8f4e']];
  const fmax=Math.max(1,views);
  const dlabel=s=>{try{return new Date(s+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short'});}catch(e){return s.slice(5);}};
  return `
  <h3 style="margin:1.6rem 0 1rem;font-size:1.1rem">Website traffic & engagement · last 7 days</h3>
  <div class="stat-row">
    <div class="stat"><div class="sl">Visits</div><b>${views.toLocaleString('en-IN')}</b></div>
    <div class="stat"><div class="sl">Product views</div><b>${prod.toLocaleString('en-IN')}</b></div>
    <div class="stat"><div class="sl">Add-to-cart</div><b>${cart.toLocaleString('en-IN')}</b></div>
    <div class="stat"><div class="sl">Conversion</div><b>${conv}%</b><div class="delta">${ord} orders</div></div>
  </div>
  <div class="detail-grid">
    <div class="dcard"><div class="dh">Daily visits</div><div class="db">
      <div class="report-bars">${days.map(d=>`<div class="rb" style="height:${Math.max(4,Math.round(d.view/maxV*100))}%"><b>${d.view}</b><span>${dlabel(d.date)}</span></div>`).join('')}</div>
    </div></div>
    <div class="dcard"><div class="dh">Conversion funnel</div><div class="db">
      ${funnel.map(f=>`<div style="margin-bottom:.7rem"><div style="display:flex;justify-content:space-between;font-size:.85rem"><span>${f[0]}</span><b>${(f[1]||0).toLocaleString('en-IN')}</b></div><div class="mini-bar"><span style="width:${Math.round((f[1]||0)/fmax*100)}%;background:${f[2]}"></span></div></div>`).join('')}
    </div></div>
  </div>`;
}

/* ---------------- CMS (audit P2 #4) ---------------- */
function renderCMS(m){
  const imgPreview=(v,ph)=>`<div class="cms-imgprev" style="width:100%;height:120px;border:1px dashed var(--line);border-radius:10px;background:${v?`center/cover no-repeat url('${v}')`:'var(--cream-deep)'};display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:.8rem">${v?'':ph}</div>`;
  m.innerHTML=`<h1>Content</h1><p class="admin-sub">Edit storefront copy and imagery without a developer — high-velocity, no code change (client #5). Saved values persist and drive the live store.</p>
  <div class="admin-panel" style="margin-bottom:1.5rem"><div class="panel-head"><h3>Brand & general</h3></div><div style="padding:1.5rem;max-width:640px">
    <div class="field"><label>Brand logo — used consistently across header, footer, login & hero (client #7)</label>${imgPreview(CMS.logo,'Using built-in logo')}<input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" onchange="cmsPickImage(this,'logo')" style="margin-top:.5rem"> ${CMS.logo?`<button class="btn-sm" style="margin-top:.5rem" onclick="cmsClearImage('logo')">Reset to default</button>`:''}<div style="font-size:.78rem;color:var(--muted);margin-top:.4rem">PNG with transparent background recommended. When set, the header shows this logo alone (the lockup already includes the name).</div></div>
    <div class="field"><label>Announcement bar</label><input id="cmsAnn" value="${escapeHtml(CMS.announcement)}"></div>
    <div class="field"><label>Return policy text</label><textarea id="cmsRet" rows="2">${escapeHtml(CMS.returnPolicy)}</textarea></div>
  </div></div>
  <div class="admin-panel" style="margin-bottom:1.5rem"><div class="panel-head"><h3>Hero (homepage top)</h3></div><div style="padding:1.5rem;max-width:640px">
    <div class="field"><label>Eyebrow</label><input id="cmsHeroEye" value="${escapeHtml(CMS.heroEyebrow||'')}"></div>
    <div class="field"><label>Headline (you may use &lt;em&gt; for the italic accent)</label><input id="cmsHeroHead" value="${escapeHtml(CMS.heroHeadline||'')}"></div>
    <div class="field"><label>Sub-text</label><textarea id="cmsHeroLead" rows="2">${escapeHtml(CMS.heroLead||'')}</textarea></div>
    <div class="field"><label>Hero image</label>${imgPreview(CMS.heroImage,'Using built-in hero art')}<input type="file" accept="image/*" onchange="cmsPickImage(this,'heroImage')" style="margin-top:.5rem"> ${CMS.heroImage?`<button class="btn-sm" style="margin-top:.5rem" onclick="cmsClearImage('heroImage')">Reset to default</button>`:''}</div>
  </div></div>
  <div class="admin-panel" style="margin-bottom:1.5rem"><div class="panel-head"><h3>Founder / Our Story</h3></div><div style="padding:1.5rem;max-width:640px">
    <div class="field"><label>Eyebrow</label><input id="cmsStoryEye" value="${escapeHtml(CMS.storyEyebrow||'')}"></div>
    <div class="field"><label>Heading</label><input id="cmsStoryHead" value="${escapeHtml(CMS.storyHeading||'')}"></div>
    <div class="field"><label>Paragraph 1</label><textarea id="cmsStoryP1" rows="3">${escapeHtml(CMS.storyP1||'')}</textarea></div>
    <div class="field"><label>Paragraph 2</label><textarea id="cmsStoryP2" rows="3">${escapeHtml(CMS.storyP2||'')}</textarea></div>
    <div class="field"><label>Story image</label>${imgPreview(CMS.storyImage,'Using built-in story art')}<input type="file" accept="image/*" onchange="cmsPickImage(this,'storyImage')" style="margin-top:.5rem"> ${CMS.storyImage?`<button class="btn-sm" style="margin-top:.5rem" onclick="cmsClearImage('storyImage')">Reset to default</button>`:''}</div>
  </div></div>
  ${reviewModerationHTML()}
  <button class="btn btn-primary" onclick="saveCMS()">Save all content</button>`;
}
/* Client QA r2: review moderation queue — approve/reject pending reviews.
   Backend mode reads pending rows (with DB ids) from /api/admin/data; offline mode
   uses the client-side REVIEWS/HOME_REVIEWS arrays. */
let PENDING_REVIEWS={home:[],product:[]};
let PUBLISHED_REVIEWS={home:[],product:[]};
let _pendingCache=[];
let _publishedCache=[];
function pendingReviews(){
  const out=[];
  if(BACKEND){
    (PENDING_REVIEWS.home||[]).forEach(r=>out.push({mode:'backend',kind:'home',id:r.id,name:r.name,rating:r.rating||0,text:r.body,where:r.location||'Homepage',img:r.img||''}));
    (PENDING_REVIEWS.product||[]).forEach(r=>{ const p=PRODUCTS.find(x=>x.sku===r.product_sku); out.push({mode:'backend',kind:'product',id:r.id,name:r.name,rating:r.rating||0,text:r.body,where:p?p.name:(r.product_sku||'Product'),img:r.img||''}); });
    return out;
  }
  (HOME_REVIEWS||[]).forEach((r,i)=>{ if(r&&r.pending) out.push({mode:'local',kind:'home',ref:i,name:r.n,rating:r.r||0,text:r.t,where:r.l||'Homepage',img:r.img||''}); });
  Object.keys(REVIEWS||{}).forEach(pid=>{ (REVIEWS[pid]||[]).forEach((r,i)=>{ if(r&&r.pending){ const p=PRODUCTS.find(x=>String(x.id)===String(pid)); out.push({mode:'local',kind:'product',pid:pid,ref:i,name:r.n,rating:r.r||0,text:r.t,where:p?p.name:('Product #'+pid),img:r.img||''}); } }); });
  return out;
}
/* Published (approved, live on the storefront) reviews — each deletable by staff. */
function publishedReviews(){
  const out=[];
  if(BACKEND){
    (PUBLISHED_REVIEWS.home||[]).forEach(r=>out.push({mode:'backend',kind:'home',id:r.id,name:r.name,rating:r.rating||0,text:r.body,where:r.location||'Homepage',img:r.img||''}));
    (PUBLISHED_REVIEWS.product||[]).forEach(r=>{ const p=PRODUCTS.find(x=>x.sku===r.product_sku); out.push({mode:'backend',kind:'product',id:r.id,name:r.name,rating:r.rating||0,text:r.body,where:p?p.name:(r.product_sku||'Product'),img:r.img||''}); });
    return out;
  }
  (HOME_REVIEWS||[]).forEach((r,i)=>{ if(r&&!r.pending) out.push({mode:'local',kind:'home',ref:i,name:r.n,rating:r.r||0,text:r.t,where:r.l||'Homepage',img:r.img||''}); });
  Object.keys(REVIEWS||{}).forEach(pid=>{ (REVIEWS[pid]||[]).forEach((r,i)=>{ if(r&&!r.pending){ const p=PRODUCTS.find(x=>String(x.id)===String(pid)); out.push({mode:'local',kind:'product',pid:pid,ref:i,name:r.n,rating:r.r||0,text:r.t,where:p?p.name:('Product #'+pid),img:r.img||''}); } }); });
  return out;
}
/* Clear context for the admin moderation queue: is this a homepage testimonial or a
   product review — and for product reviews, which product (client feedback). */
function reviewCtxLabel(r){
  return r && r.kind==='product'
    ? `🛒 Product review · <b>${escapeHtml(r.where||'Product')}</b>`
    : `🏠 Home / Testimonial`;
}
function reviewModerationHTML(){
  _pendingCache=pendingReviews();
  _publishedCache=publishedReviews();
  const pend=_pendingCache, pub=_publishedCache;
  return `<div class="admin-panel" style="margin-bottom:1.5rem"><div class="panel-head"><h3>Review moderation${pend.length?` · ${pend.length} pending`:''}</h3></div>
    <div style="padding:1.2rem">
    ${pend.length?pend.map((r,i)=>`<div class="mod-review">
      <div class="mod-main"><div class="mod-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div>
        <div class="mod-who"><b>${escapeHtml(r.name||'Anonymous')}</b> · <span class="mod-kind ${r.kind}">${reviewCtxLabel(r)}</span></div>
        <p class="mod-text">"${escapeHtml(r.text||'')}"</p>${r.img?`<img class="mod-photo" src="${escapeHtml(r.img)}" alt="review photo" onclick="openImgLightbox('${escapeHtml(r.img)}')">`:''}</div>
      <div class="mod-acts">
        <button class="btn-sm primary" onclick="moderateReview('approve',${i})">Approve</button>
        <button class="btn-sm danger" onclick="moderateReview('reject',${i})">Reject</button>
      </div></div>`).join('')
      :`<p class="acct-empty" style="margin:0">No reviews awaiting approval. New customer reviews appear here for approval before they show on the storefront.</p>`}
    </div>
    <div class="panel-head" style="border-top:1px solid var(--line,#eadfce)"><h3>Published reviews${pub.length?` · ${pub.length} live`:''}</h3></div>
    <div style="padding:1.2rem">
    ${pub.length?pub.map((r,i)=>`<div class="mod-review">
      <div class="mod-main"><div class="mod-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div>
        <div class="mod-who"><b>${escapeHtml(r.name||'Anonymous')}</b> · <span class="mod-kind ${r.kind}">${reviewCtxLabel(r)}</span></div>
        <p class="mod-text">"${escapeHtml(r.text||'')}"</p>${r.img?`<img class="mod-photo" src="${escapeHtml(r.img)}" alt="review photo" onclick="openImgLightbox('${escapeHtml(r.img)}')">`:''}</div>
      <div class="mod-acts">
        <button class="btn-sm danger" onclick="deletePublishedReview(${i})">Delete</button>
      </div></div>`).join('')
      :`<p class="acct-empty" style="margin:0">No published reviews yet. Approved reviews appear here and can be removed at any time.</p>`}
    </div></div>`;
}
async function deletePublishedReview(i){
  const r=_publishedCache[i]; if(!r) return;
  if(!confirm('Delete this published review? It will be removed from the storefront immediately.')) return;
  if(r.mode==='backend'){
    const res=await adminSync('review.delete',{kind:r.kind, id:r.id});
    if(!res || res.ok===false){ toast((res&&res.err)||'Could not delete review'); return; }
    if(r.kind==='home') PUBLISHED_REVIEWS.home=(PUBLISHED_REVIEWS.home||[]).filter(x=>x.id!==r.id);
    else PUBLISHED_REVIEWS.product=(PUBLISHED_REVIEWS.product||[]).filter(x=>x.id!==r.id);
    // drop it from the live storefront arrays too so it disappears without a reload
    if(r.kind==='home'){ const idx=(HOME_REVIEWS||[]).findIndex(x=>x&&x.t===r.text&&x.n===r.name); if(idx>-1) HOME_REVIEWS.splice(idx,1); }
    else { const p=PRODUCTS.find(x=>x.name===r.where); const arr=p&&REVIEWS[p.id]; if(arr){ const idx=arr.findIndex(x=>x&&x.t===r.text&&x.n===r.name); if(idx>-1){ arr.splice(idx,1); if(p.reviews>0) p.reviews--; } } }
    toast('Review deleted'); renderAdminTab(); renderHomeReviews&&renderHomeReviews();
    return;
  }
  // offline / localStorage
  if(r.kind==='home'){ if(HOME_REVIEWS&&HOME_REVIEWS[r.ref]) HOME_REVIEWS.splice(r.ref,1); saveHomeReviews(); }
  else { const arr=REVIEWS[r.pid]; if(arr&&arr[r.ref]){ arr.splice(r.ref,1); saveReviews(); const p=PRODUCTS.find(x=>String(x.id)===String(r.pid)); if(p&&p.reviews>0) p.reviews--; } }
  toast('Review deleted'); renderAdminTab(); renderHomeReviews&&renderHomeReviews();
}
async function moderateReview(action,i){
  const r=_pendingCache[i]; if(!r) return;
  if(action==='reject' && !confirm('Reject and remove this review?')) return;
  if(r.mode==='backend'){
    const res=await adminSync(action==='approve'?'review.approve':'review.reject',{kind:r.kind, id:r.id});
    if(!res || res.ok===false){ toast((res&&res.err)||'Could not update review'); return; }
    if(r.kind==='home') PENDING_REVIEWS.home=(PENDING_REVIEWS.home||[]).filter(x=>x.id!==r.id);
    else PENDING_REVIEWS.product=(PENDING_REVIEWS.product||[]).filter(x=>x.id!==r.id);
    toast(action==='approve'?'Review approved — now visible':'Review rejected'); renderAdminTab();
    return;
  }
  // offline / localStorage
  if(action==='approve'){
    if(r.kind==='home'){ const rv=(HOME_REVIEWS||[])[r.ref]; if(rv){ rv.pending=false; rv.v=true; saveHomeReviews(); } }
    else { const arr=REVIEWS[r.pid]; if(arr&&arr[r.ref]){ arr[r.ref].pending=false; arr[r.ref].v=true; saveReviews(); const p=PRODUCTS.find(x=>String(x.id)===String(r.pid)); if(p) p.reviews=(p.reviews||0)+1; } }
    toast('Review approved — now visible');
  } else {
    if(r.kind==='home'){ if(HOME_REVIEWS&&HOME_REVIEWS[r.ref]) HOME_REVIEWS.splice(r.ref,1); saveHomeReviews(); }
    else { const arr=REVIEWS[r.pid]; if(arr&&arr[r.ref]) arr.splice(r.ref,1); saveReviews(); }
    toast('Review rejected');
  }
  renderAdminTab(); renderHomeReviews&&renderHomeReviews();
}
function cmsPickImage(input,key){
  const f=input.files&&input.files[0]; if(!f)return;
  if(f.size>1.5*1024*1024){toast("Image too large — please use one under 1.5 MB");input.value="";return;}
  const r=new FileReader();
  r.onload=e=>{CMS[key]=e.target.result;persist&&persist("cms",CMS);adminSync('config.set',{key:'cms',value:CMS});logAudit("cms.image",key,"uploaded");renderCMS($("#adminMain"));toast("Image updated — Save to apply live");};
  r.readAsDataURL(f);
}
function cmsClearImage(key){CMS[key]="";persist&&persist("cms",CMS);adminSync('config.set',{key:'cms',value:CMS});logAudit("cms.image",key,"reset");renderCMS($("#adminMain"));}
function saveCMS(){
  CMS.announcement=$("#cmsAnn").value;CMS.returnPolicy=$("#cmsRet").value;
  CMS.heroEyebrow=$("#cmsHeroEye").value;CMS.heroHeadline=$("#cmsHeroHead").value;CMS.heroLead=$("#cmsHeroLead").value;
  CMS.storyEyebrow=$("#cmsStoryEye").value;CMS.storyHeading=$("#cmsStoryHead").value;CMS.storyP1=$("#cmsStoryP1").value;CMS.storyP2=$("#cmsStoryP2").value;
  adminSync('config.set',{key:'cms',value:CMS});
  logAudit("cms.update","storefront","content edited");persistAll();
  applyCMS();   // push every edited field to the live storefront immediately
  toast("Content saved — live on the storefront");
}
/* Client escalation: CMS edits must reflect on the storefront. renderSite() reads CMS
   at build time (correct on load); applyCMS() also updates the live DOM so edits show
   without a reload — for the announcement bar, hero copy, story copy and return policy. */
function applyCMS(){
  const setTxt=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v||'';};
  const setHtml=(id,v)=>{const el=document.getElementById(id);if(el)el.innerHTML=v||'';};
  setTxt('announceBar', CMS.announcement);
  setTxt('heroEyebrowEl', CMS.heroEyebrow);
  setHtml('heroHeadlineEl', CMS.heroHeadline);   // headline allows inline <em>
  setTxt('heroLeadEl', CMS.heroLead);
  setTxt('storyEyebrowEl', CMS.storyEyebrow);
  setTxt('storyHeadingEl', CMS.storyHeading);
  setTxt('storyP1El', CMS.storyP1);
  setTxt('storyP2El', CMS.storyP2);
  setTxt('footReturns', CMS.returnPolicy);
  // refresh every logo instance so a CMS logo change reflects live (header, footer,
  // login card, hero seal) without needing a full page reload
  const logo=brandLogo();
  document.querySelectorAll('.brand.has-logo img, .foot-brand img, .lc-logo img, img.seal').forEach(img=>{ if(img.getAttribute('src')!==logo) img.src=logo; });
}

/* ---------------- AUDIT LOG (audit P0 #5) ---------------- */
let auditSearch="";
function setAuditSearch(v){auditSearch=v.toLowerCase();renderAuditLog($("#adminMain"));}
function renderAuditLog(m){
  let list=AUDIT.filter(a=>a.action.toLowerCase().includes(auditSearch)||a.entity.toLowerCase().includes(auditSearch)||(a.detail||'').toLowerCase().includes(auditSearch)||a.actor.toLowerCase().includes(auditSearch));
  m.innerHTML=`<h1>Audit Log</h1><p class="admin-sub">Immutable trail of every admin mutation — actor, action, entity, detail, timestamp.</p>
  <div class="tool-row"><input class="admin-search" placeholder="Search actions, entities…" oninput="setAuditSearch(this.value)" value="${escapeHtml(auditSearch)}"><div class="spacer"></div><button class="btn-sm" onclick="exportAuditCSV()">⭳ Export</button></div>
  <div class="admin-panel"><div class="panel-head"><h3>${list.length} entries</h3></div>
  <table><thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead><tbody>
  ${list.length?list.map(a=>`<tr><td style="font-size:.8rem;color:var(--muted)">${a.t}</td><td>${escapeHtml(a.actor)}</td><td><span class="tag-pill">${escapeHtml(a.action)}</span></td><td>${escapeHtml(a.entity)}</td><td style="font-size:.84rem">${escapeHtml(a.detail||'')}</td></tr>`).join(''):`<tr><td colspan="5"><div class="empty-state"><div class="ic">☷</div>No audit entries match.</div></td></tr>`}
  </tbody></table></div>`;
}
function exportAuditCSV(){
  const rows=[["Timestamp","Actor","Action","Entity","Detail"]];
  AUDIT.forEach(a=>rows.push([a.t,a.actor,a.action,a.entity,a.detail||'']));
  downloadCSV(rows,"suddhalaya_audit.csv");
}

/* ---------------- ROLES / RBAC (audit P0 #4 / §7.15) ---------------- */
function renderRoles(m){
  m.innerHTML=`<h1>Users & Roles</h1><p class="admin-sub">Multi-user accounts with role-based access control. (Demo: scaffolding for the production RBAC model.)</p>
  <div class="admin-panel" style="margin-bottom:1.5rem"><div class="panel-head"><h3>Staff accounts</h3><button class="btn-sm primary" onclick="addStaff()">＋ Add user</button></div>
  <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Permissions</th><th>Active</th><th></th></tr></thead><tbody>
  ${STAFF.map(s=>`<tr>
    <td><b>${escapeHtml(s.name)}</b></td><td style="color:var(--muted);font-size:.84rem">${escapeHtml(s.email)}</td>
    <td><select class="adm-select" onchange="setStaffRole(${s.id},this.value)">${Object.keys(ROLES).map(r=>`<option value="${r}" ${s.role===r?'selected':''}>${ROLES[r].label}</option>`).join('')}</select></td>
    <td style="font-size:.78rem;color:var(--muted)">${ROLES[s.role].perms.join(', ')}</td>
    <td><div class="tog ${s.active?'on':''}" onclick="toggleStaff(${s.id})"></div></td>
    <td style="text-align:right"><button title="Remove ${escapeHtml(s.name)}" onclick="removeStaff(${s.id})" style="background:none;border:1px solid rgba(192,57,43,.35);color:#c0392b;font-family:inherit;font-size:.76rem;padding:.32rem .7rem;border-radius:7px;cursor:pointer">Remove</button></td>
  </tr>`).join('')}
  </tbody></table></div>
  <div class="admin-panel"><div class="panel-head"><h3>Role definitions</h3></div><div style="padding:1.5rem">
    ${Object.keys(ROLES).map(r=>`<div class="kv"><span><b>${ROLES[r].label}</b></span><span style="color:var(--muted);font-size:.82rem">${ROLES[r].perms.join(', ')}</span></div>`).join('')}
  </div></div>`;
}
function addStaff(){
  const name=prompt("Staff name:");if(!name)return;const email=prompt("Email:")||name.toLowerCase().replace(/\s/g,'')+"@suddhalaya.com";
  STAFF.push({id:Date.now(),name,email,role:"support",active:true});dbSave("staff",STAFF);logAudit("staff.create",email,name);renderAdminTab();toast("User added");
}
function setStaffRole(id,role){const s=STAFF.find(x=>x.id===id);if(s){s.role=role;dbSave("staff",STAFF);logAudit("staff.role",s.email,role);renderAdminTab();toast("Role updated");}}
function toggleStaff(id){const s=STAFF.find(x=>x.id===id);if(s){s.active=!s.active;dbSave("staff",STAFF);logAudit("staff.toggle",s.email,s.active?"active":"disabled");renderAdminTab();}}
function removeStaff(id){
  const s=STAFF.find(x=>x.id===id); if(!s) return;
  // Never let the last Owner be deleted — that would lock everyone out of admin.
  if(s.role==='owner' && STAFF.filter(x=>x.role==='owner').length<=1){ toast("Can't remove the only Owner account"); return; }
  if(!confirm(`Remove ${s.name} (${s.email})?\nThey will lose admin access.`)) return;
  STAFF=STAFF.filter(x=>x.id!==id); dbSave("staff",STAFF); logAudit("staff.remove",s.email,s.name); renderAdminTab(); toast("User removed");
}

/* ---------------- SETTINGS (audit P2 #5 / §7.17) ---------------- */
function renderSettings(m){
  m.innerHTML=`<h1>Settings</h1><p class="admin-sub">Persisted store configuration, security and integrations.</p>
  <div class="admin-panel" style="margin-bottom:1.5rem"><div class="panel-head"><h3>Store configuration</h3></div><div style="padding:1.5rem;max-width:560px">
    <div class="field row2"><div><label>Store name</label><input id="setName" value="${escapeHtml(SETTINGS.storeName)}"></div><div><label>Support email</label><input id="setEmail" value="${escapeHtml(SETTINGS.supportEmail)}"></div></div>
    <div class="field row2"><div><label>Free shipping over (₹)</label><input id="setFree" type="number" value="${SETTINGS.freeShipThreshold}"></div><div><label>Flat shipping (₹)</label><input id="setShip" type="number" value="${SETTINGS.flatShip}"></div></div>
    <div class="field row2"><div><label>GSTIN</label><input id="setGstin" value="${escapeHtml(SETTINGS.gstin)}"></div><div><label>Invoice prefix</label><input id="setInv" value="${escapeHtml(SETTINGS.invoicePrefix)}"></div></div>
    <button class="btn-sm primary" onclick="saveSettings()">Save configuration</button>
  </div></div>
  ${(()=>{const c=storeContact();return `<div class="admin-panel" style="margin-bottom:1.5rem"><div class="panel-head"><h3>Contact &amp; social details</h3></div><div style="padding:1.5rem;max-width:640px">
    <p style="font-size:.82rem;color:var(--muted);margin:-.3rem 0 1rem">Client QA r2: these drive the footer “Get in Touch”, the social row and the floating contact buttons — no code change.</p>
    <div class="field row2"><div><label>Phone (display)</label><input id="ctPhone" value="${escapeHtml(c.phone)}" placeholder="+91 9368140887"></div><div><label>WhatsApp number (digits, incl. country code)</label><input id="ctWa" value="${escapeHtml(c.whatsapp)}" placeholder="919368140887"></div></div>
    <div class="field"><label>Business address</label><input id="ctAddr" value="${escapeHtml(c.address)}" placeholder="Street, City, State, PIN"></div>
    <div class="field row2"><div><label>Business hours</label><input id="ctHours" value="${escapeHtml(c.hours)}" placeholder="Mon – Sat: 9:00 AM – 7:00 PM"></div><div><label>Support email</label><input id="ctEmail" value="${escapeHtml(c.email)}" placeholder="support@suddhalaya.com"></div></div>
    <div class="field row2"><div><label>Instagram URL</label><input id="ctIg" value="${escapeHtml(c.instagram)}" placeholder="https://instagram.com/…"></div><div><label>Facebook URL</label><input id="ctFb" value="${escapeHtml(c.facebook)}" placeholder="https://facebook.com/…"></div></div>
    <div class="field row2"><div><label>X (Twitter) URL</label><input id="ctX" value="${escapeHtml(c.twitter)}" placeholder="https://x.com/…"></div><div><label>LinkedIn URL</label><input id="ctLi" value="${escapeHtml(c.linkedin)}" placeholder="https://linkedin.com/company/…"></div></div>
    <button class="btn-sm primary" onclick="saveContactSettings()">Save contact details</button>
  </div></div>`;})()}
  <div class="admin-panel" style="margin-bottom:1.5rem"><div class="panel-head"><h3>Notifications</h3></div><div style="padding:1.5rem;max-width:560px">
    <div class="kv"><span>Email notifications</span><span><div class="tog ${SETTINGS.notifyEmail?'on':''}" onclick="toggleNotify('notifyEmail',this)"></div></span></div>
    <div class="kv"><span>SMS notifications</span><span><div class="tog ${SETTINGS.notifySms?'on':''}" onclick="toggleNotify('notifySms',this)"></div></span></div>
    <div class="kv"><span>WhatsApp notifications</span><span><div class="tog ${SETTINGS.notifyWhatsapp?'on':''}" onclick="toggleNotify('notifyWhatsapp',this)"></div></span></div>
    <p style="font-size:.8rem;color:var(--muted);margin-top:.8rem">${NOTIFY_LOG.length} notifications logged this session.</p>
  </div></div>
  <div class="admin-panel" style="margin-bottom:1.5rem"><div class="panel-head"><h3>Transactional email (SMTP)</h3></div><div style="padding:1.5rem;max-width:560px">
    <p style="font-size:.82rem;color:var(--muted);margin:-.2rem 0 1rem">Welcome &amp; order-confirmation emails send automatically once SMTP is configured in <code>.env.local</code> (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM). Send yourself a test to confirm.</p>
    <div class="field row2"><div><label>Send test to</label><input id="mailTestTo" type="email" placeholder="you@example.com"></div><div style="display:flex;align-items:flex-end"><button class="btn-sm primary" onclick="adminMailTest()">Send test email</button></div></div>
    <div id="mailTestMsg" style="font-size:.84rem;margin-top:.4rem"></div>
  </div></div>
  <div class="admin-panel" style="margin-bottom:1.5rem"><div class="panel-head"><h3>Storefront</h3></div><div style="padding:1.5rem;max-width:560px">
    <div class="kv"><span>Show "Customer Reviews" section on homepage<br><small style="color:var(--muted)">Hide or show the reviews block instantly — no code change.</small></span><span><div class="tog ${REVIEWS_ENABLED?'on':''}" onclick="adminToggleReviews(this)"></div></span></div>
  </div></div>
  <div class="admin-panel" style="margin-bottom:1.5rem"><div class="panel-head"><h3>Payments — Cash on Delivery</h3></div><div style="padding:1.5rem;max-width:560px">
    <div class="kv"><span>Enable Cash on Delivery (COD)<br><small style="color:var(--muted)">When off, COD is hidden at checkout and only prepaid (UPI/Card) is offered. (client #4)</small></span><span><div class="tog ${SETTINGS.codEnabled!==false?'on':''}" onclick="toggleSetting('codEnabled',this)"></div></span></div>
    <div class="field" style="margin-top:1rem"><label>COD limit — hide COD above this order total (₹, 0 = no limit)</label><input id="setCodMax" type="number" min="0" value="${SETTINGS.codMaxOrder||0}"></div>
    <button class="btn-sm primary" onclick="saveCodSettings()">Save COD settings</button>
  </div></div>
  <div class="admin-panel" style="margin-bottom:1.5rem"><div class="panel-head"><h3>Change Password</h3></div><div style="padding:1.5rem;max-width:440px">
    <div class="simnote">Passwords are stored only as a salted hash on the server in production. Recovery via OTP to ${escapeHtml(SETTINGS.supportEmail)}.</div>
    <div class="field"><label>Current Password</label><input id="curPass" type="password"></div>
    <div class="field"><label>New Password</label><input id="newPass" type="password"></div>
    <div class="field"><label>Confirm New Password</label><input id="conPass" type="password"></div>
    <button class="btn btn-primary" onclick="changePass()">Update Password</button>
  </div></div>
  <div class="admin-panel"><div class="panel-head"><h3>Integrations</h3></div><div style="padding:1.5rem">
    <p style="font-size:.88rem;color:var(--muted);margin-bottom:1rem">In production these connect to live services via the backend with credential management and health checks:</p>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:.8rem">
      ${SETTINGS.integrations.map(x=>`<div style="border:1px solid var(--line);border-radius:10px;padding:1rem;background:var(--white)"><b style="font-size:.9rem;color:var(--forest)">${escapeHtml(x[0])}</b><br><small style="color:var(--muted)">${escapeHtml(x[1])}</small><br><span class="badge ${x[2]}" style="margin-top:.4rem">${x[2]==='in'?'Connected':x[2]==='low'?'Pending':'Not set'}</span></div>`).join('')}
    </div>
  </div></div>`;
}
function saveSettings(){
  SETTINGS.storeName=$("#setName").value;SETTINGS.supportEmail=$("#setEmail").value;
  SETTINGS.freeShipThreshold=parseInt($("#setFree").value)||0;SETTINGS.flatShip=parseInt($("#setShip").value)||0;
  SETTINGS.gstin=$("#setGstin").value;SETTINGS.invoicePrefix=$("#setInv").value;
  adminSync('config.set',{key:'settings',value:SETTINGS});
  logAudit("settings.update","store","configuration saved");persistAll();renderAdmin();toast("Settings saved");
}
/* Client QA r2: SMTP diagnostic — send a test email from the admin console. */
async function adminMailTest(){
  const msg=$("#mailTestMsg"); const to=($("#mailTestTo")?.value||"").trim();
  if(msg){msg.style.color='var(--muted)';msg.textContent='Sending…';}
  try{
    const r=await (await fetch('/api/admin/mail-test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to})})).json();
    if(msg){
      if(r.ok){ msg.style.color='var(--leaf)'; msg.textContent='✓ Test email sent to '+(r.to||to)+'. Check the inbox (and spam).'; }
      else if(r.configured===false){ msg.style.color='#b4551d'; msg.textContent='SMTP not configured — add SMTP_* keys to .env.local and restart.'; }
      else { msg.style.color='#b4551d'; msg.textContent='✕ '+(r.err||'Could not send test email'); }
    }
  }catch(e){ if(msg){msg.style.color='#b4551d';msg.textContent='✕ Request failed';} }
}
/* Client QA r2: save admin-editable contact/social details. */
function saveContactSettings(){
  const g=id=>($("#"+id)?.value||"").trim();
  SETTINGS.contactPhone=g('ctPhone'); SETTINGS.whatsapp=g('ctWa').replace(/\D/g,'');
  SETTINGS.addressLine=g('ctAddr'); SETTINGS.hours=g('ctHours'); SETTINGS.supportEmail=g('ctEmail')||SETTINGS.supportEmail;
  SETTINGS.instagram=g('ctIg'); SETTINGS.facebook=g('ctFb'); SETTINGS.twitter=g('ctX'); SETTINGS.linkedin=g('ctLi');
  adminSync('config.set',{key:'settings',value:SETTINGS});
  logAudit("settings.update","contact","contact & social details saved");
  persistAll(); applyStoreContact();
  const dock=document.getElementById('contactDock'); if(dock){dock.remove(); injectContactDock(); const d=document.getElementById('contactDock'); if(d)d.classList.add('ready');}
  toast("Contact details saved — footer & dock updated");
}
function toggleNotify(key,el){SETTINGS[key]=!SETTINGS[key];el.classList.toggle('on');logAudit("settings.notify",key,SETTINGS[key]?"on":"off");persistAll();}
function toggleSetting(key,el){SETTINGS[key]=(SETTINGS[key]===false);el.classList.toggle('on',SETTINGS[key]);adminSync('config.set',{key:'settings',value:SETTINGS});logAudit("settings.update",key,SETTINGS[key]?"on":"off");persistAll();toast((key==='codEnabled'?'COD ':key+' ')+(SETTINGS[key]?'enabled':'disabled'));}
function saveCodSettings(){SETTINGS.codMaxOrder=Math.max(0,parseInt($("#setCodMax").value)||0);adminSync('config.set',{key:'settings',value:SETTINGS});logAudit("settings.update","codMaxOrder",String(SETTINGS.codMaxOrder));persistAll();toast("COD settings saved");}
function setOrderStatus(idx,s){ // legacy shim kept for any old callers
  const o=ORDERS[idx];if(!o)return;o.status=s;persistAll();toast(`Order ${o.id} → ${s}`);
}
async function changePass(){
  const cur=$("#curPass").value,nw=$("#newPass").value,cn=$("#conPass").value;
  if(await sha256(cur)!==adminPassHash){toast("Current password is incorrect");return;}
  if(nw.length<8){toast("New password must be 8+ characters");return;}
  if(nw!==cn){toast("Passwords don't match");return;}
  adminPassHash=await sha256(nw);logAudit("auth.password","admin","changed");toast("Password updated successfully");$("#curPass").value=$("#newPass").value=$("#conPass").value="";
}

/* ========== ROUTING ========== */
function route(path){
  const site=$("#siteView"),login=$("#loginView"),admin=$("#adminView");
  if(path==='/admin'&&loginStage==='in'){
    site.style.display='none';login.style.display='none';admin.style.display='block';
    document.body.classList.add('admin-active');   // hide storefront dock/cookie banner in admin
    history.replaceState({},'','#/admin');renderAdmin();window.scrollTo(0,0);
  } else if(path==='/admin'){
    site.style.display='none';admin.style.display='none';login.style.display='flex';
    document.body.classList.add('admin-active');
    history.replaceState({},'','#/admin');renderLogin();window.scrollTo(0,0);
  } else {
    site.style.display='block';login.style.display='none';admin.style.display='none';
    document.body.classList.remove('admin-active');
    history.replaceState({},'','#/');
    if(typeof showSitePage==='function') showSitePage('home');   // land on the home page
  }
}
/* Neutral loader shown on /admin while we work out whether there's a staff session
   — avoids flashing the login form for ~3s during the backend handshake on refresh. */
function showAdminLoading(){
  ensureSpinCss();
  const site=$("#siteView"),login=$("#loginView"),admin=$("#adminView");
  if(site)site.style.display='none'; if(admin)admin.style.display='none';
  if(login){
    login.style.display='flex';
    login.innerHTML='<div style="margin:auto;display:flex;flex-direction:column;align-items:center;gap:.9rem"><span class="btn-spin" style="width:2.2rem;height:2.2rem;border-width:3px;margin:0;color:#c9a85e"></span><span style="font-size:.85rem;letter-spacing:.03em;color:rgba(241,233,218,.7)">Loading…</span></div>';
  }
  document.body.classList.add('admin-active');
}
function checkRoute(){
  const h=location.hash;
  if(h.includes('/admin')){
    if(loginStage==='in'){ route('/admin'); return; }   // already signed in this session
    if(BACKEND){
      // backend up: check for an existing staff session, showing a loader meanwhile
      showAdminLoading();
      SDBA.session().then(async s=>{
        if(s && s.staff){ currentUser={name:s.staff.name, role:s.staff.role}; loginStage='in'; await loadAdminData(); }
        route('/admin');
      }).catch(()=>route('/admin'));
      return;
    }
    // Backend not resolved yet → show the loader instead of flashing the login gate
    // during the connect. boot() re-runs checkRoute once bootstrap resolves; if we
    // turn out to be offline (BOOTED but no backend) we fall through to the login.
    if(!BOOTED){ showAdminLoading(); return; }
    route('/admin');
  } else {
    // site route — show the store and let the page router honor the hash (Home/About),
    // WITHOUT clobbering the anchor the way route('/') does.
    const site=$("#siteView"),login=$("#loginView"),admin=$("#adminView");
    if(site)site.style.display='block'; if(login)login.style.display='none'; if(admin)admin.style.display='none';
    document.body.classList.remove('admin-active');
    initSitePage();
  }
}

/* ========== INIT ========== */
/* ---- Contact details (brief §"Contact us") ---- */
/* Client QA r2: store contact + social details are admin-editable (Settings tab)
   and drive the footer "Get in Touch", the social row and the floating dock. */
function storeContact(){
  const s=SETTINGS||{};
  return {
    phone:    s.contactPhone || "+91 9368140887",
    whatsapp: (s.whatsapp || "919368140887").replace(/\D/g,''),
    email:    s.supportEmail || "support@suddhalaya.com",
    address:  s.addressLine || "Bengaluru, Karnataka, India",
    hours:    s.hours || "Mon – Sat: 9:00 AM – 7:00 PM",
    instagram: s.instagram || "https://instagram.com/suddhalaya",
    facebook:  s.facebook  || "https://facebook.com/suddhalaya",
    twitter:   s.twitter   || "https://x.com/suddhalaya",
    linkedin:  s.linkedin  || "https://linkedin.com/company/suddhalaya",
  };
}
const CONTACT = storeContact();   // kept for back-compat; live values come from storeContact()
/* Apply the current store contact/social details to the footer DOM. */
function applyStoreContact(){
  const c=storeContact();
  const setTxt=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  const setHref=(id,v)=>{const el=document.getElementById(id);if(el)el.setAttribute('href',v);};
  const ph=document.getElementById('footPhone'); if(ph){ph.textContent=c.phone;ph.setAttribute('href','tel:'+(c.phone||'').replace(/[^\d+]/g,''));}
  const em=document.getElementById('footEmail'); if(em){em.textContent=c.email;em.setAttribute('href','mailto:'+c.email);}
  setTxt('footHours',c.hours); setTxt('footAddress',c.address);
  setHref('footIg',c.instagram); setHref('footFb',c.facebook); setHref('footLi',c.linkedin);
}
function injectContactDock(){
  if(document.getElementById('contactDock'))return;
  const c=storeContact();
  const waMsg=encodeURIComponent("Hi Suddhalaya! I'd like to know more about your products.");
  const html=`<div class="contact-dock" id="contactDock" aria-label="Contact Suddhalaya">
    <button class="cd-btn cd-top" id="backToTop" onclick="scrollToTop()" aria-label="Back to top" title="Back to top">
      <span class="cd-tip">Back to top</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
    </button>
    <a class="cd-btn cd-ig" href="${c.instagram}" target="_blank" rel="noopener" aria-label="Instagram">
      <span class="cd-tip">Instagram</span>
      <svg viewBox="0 0 24 24"><path d="M12 2.2c3.2 0 3.6 0 4.9.07 1.2.06 1.8.25 2.2.42.6.22 1 .48 1.4.9.42.4.68.8.9 1.4.17.4.36 1 .42 2.2.07 1.3.07 1.7.07 4.9s0 3.6-.07 4.9c-.06 1.2-.25 1.8-.42 2.2-.22.6-.48 1-.9 1.4-.4.42-.8.68-1.4.9-.4.17-1 .36-2.2.42-1.3.07-1.7.07-4.9.07s-3.6 0-4.9-.07c-1.2-.06-1.8-.25-2.2-.42-.6-.22-1-.48-1.4-.9-.42-.4-.68-.8-.9-1.4-.17-.4-.36-1-.42-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.07-4.9c.06-1.2.25-1.8.42-2.2.22-.6.48-1 .9-1.4.4-.42.8-.68 1.4-.9.4-.17 1-.36 2.2-.42C8.4 2.2 8.8 2.2 12 2.2Zm0 1.8c-3.1 0-3.5 0-4.7.07-1.1.05-1.7.24-2.1.4-.5.2-.9.43-1.3.83-.4.4-.63.8-.83 1.3-.16.4-.35 1-.4 2.1C2.6 9.7 2.6 10.1 2.6 12s0 2.3.07 3.5c.05 1.1.24 1.7.4 2.1.2.5.43.9.83 1.3.4.4.8.63 1.3.83.4.16 1 .35 2.1.4 1.2.07 1.6.07 4.7.07s3.5 0 4.7-.07c1.1-.05 1.7-.24 2.1-.4.5-.2.9-.43 1.3-.83.4-.4.63-.8.83-1.3.16-.4.35-1 .4-2.1.07-1.2.07-1.6.07-3.5s0-2.3-.07-3.5c-.05-1.1-.24-1.7-.4-2.1-.2-.5-.43-.9-.83-1.3-.4-.4-.8-.63-1.3-.83-.4-.16-1-.35-2.1-.4C15.5 4 15.1 4 12 4Zm0 3.1a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8Zm0 1.8a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2Zm5.1-.3a1.15 1.15 0 1 1-2.3 0 1.15 1.15 0 0 1 2.3 0Z"/></svg>
    </a>
    <a class="cd-btn cd-em" href="mailto:${c.email}" aria-label="Email support">
      <span class="cd-tip">Email us</span>
      <svg viewBox="0 0 24 24"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9 7.2 8-5.2H4l8 5.2ZM4 8.3V17h16V8.3l-7.5 4.9a1 1 0 0 1-1 0L4 8.3Z"/></svg>
    </a>
    <a class="cd-btn cd-wa" href="https://wa.me/${c.whatsapp}?text=${waMsg}" target="_blank" rel="noopener" aria-label="WhatsApp">
      <span class="cd-tip">Chat on WhatsApp</span>
      <svg viewBox="0 0 24 24"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.9c0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.38a9.9 9.9 0 0 0 4.73 1.2h.01c5.46 0 9.9-4.45 9.9-9.9 0-2.64-1.03-5.13-2.9-7A9.82 9.82 0 0 0 12.04 2Zm0 1.8c2.16 0 4.18.84 5.71 2.37a8.03 8.03 0 0 1 2.37 5.72c0 4.46-3.63 8.1-8.1 8.1a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.06.8.82-2.99-.2-.31a8.05 8.05 0 0 1-1.24-4.29c0-4.46 3.63-8.1 8.1-8.1Zm-2.6 4.05c-.13 0-.34.05-.52.24-.18.2-.69.68-.69 1.65 0 .97.71 1.91.81 2.04.1.13 1.39 2.21 3.39 3.02 1.66.68 2 .54 2.36.51.36-.03 1.16-.47 1.32-.93.16-.46.16-.85.11-.93-.05-.08-.18-.13-.38-.23-.2-.1-1.16-.57-1.34-.64-.18-.06-.31-.1-.44.1-.13.2-.5.64-.62.77-.11.13-.23.15-.43.05-.2-.1-.84-.31-1.6-.99-.59-.53-.99-1.18-1.11-1.38-.11-.2-.01-.31.09-.41.09-.09.2-.23.3-.35.1-.12.13-.2.2-.34.06-.13.03-.25-.02-.35-.05-.1-.44-1.08-.62-1.48-.15-.36-.31-.31-.43-.32l-.37-.01Z"/></svg>
    </a>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  // animate the dock in shortly after load
  setTimeout(()=>{ const d=document.getElementById('contactDock'); if(d)d.classList.add('ready'); }, 600);
  // back-to-top: reveal only after the user has scrolled a screenful (client QA r2)
  const onScrollTop=()=>{ const btn=document.getElementById('backToTop'); if(btn)btn.classList.toggle('show', window.scrollY>window.innerHeight*0.6); };
  window.addEventListener('scroll', onScrollTop, {passive:true}); onScrollTop();
  // client feedback: dissolve the floating dock once the footer is reached (was overlapping it)
  const footer=document.querySelector('footer');
  if(footer && 'IntersectionObserver' in window){
    const io=new IntersectionObserver((es)=>{ const d=document.getElementById('contactDock'); if(d) d.classList.toggle('at-footer', es[0].isIntersecting); }, {threshold:0.02});
    io.observe(footer);
  }
}
function scrollToTop(){ window.scrollTo({top:0,behavior:'smooth'}); }

/* ---- Scroll-reveal engine (IntersectionObserver) ---- */
let _revealObserver=null;
function initRevealObserver(){
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const els = document.querySelectorAll('.reveal, .reveal-stagger');
  if(reduce || !('IntersectionObserver' in window)){
    els.forEach(el=>el.classList.add('is-visible')); return;
  }
  if(_revealObserver) _revealObserver.disconnect();
  _revealObserver = new IntersectionObserver((entries)=>{
    entries.forEach(en=>{
      if(en.isIntersecting){
        en.target.classList.add('is-visible');
        if(en.target.id==='heroStats' || en.target.querySelector?.('#heroStats')) {}
        _revealObserver.unobserve(en.target);
      }
    });
  },{threshold:0.12, rootMargin:'0px 0px -8% 0px'});
  els.forEach(el=>_revealObserver.observe(el));
}

/* ---- Count-up animation for hero stats ---- */
let _countDone=false;
function runCountUp(){
  if(_countDone)return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nums=document.querySelectorAll('#heroStats b[data-count]');
  if(!nums.length)return;
  _countDone=true;
  nums.forEach(el=>{
    const target=parseFloat(el.dataset.count), suffix=el.dataset.suffix||'', dec=parseInt(el.dataset.dec||'0',10);
    if(reduce){ el.textContent=(dec?target.toFixed(dec):target)+suffix; return; }
    const dur=1400, start=performance.now();
    function step(now){
      const t=Math.min(1,(now-start)/dur);
      const eased=1-Math.pow(1-t,3);
      const val=target*eased;
      el.textContent=(dec?val.toFixed(dec):Math.round(val))+suffix;
      if(t<1)requestAnimationFrame(step);
      else el.textContent=(dec?target.toFixed(dec):target)+suffix;
    }
    requestAnimationFrame(step);
  });
}
function watchHeroStats(){
  const hs=document.getElementById('heroStats'); if(!hs)return;
  if(!('IntersectionObserver' in window)){runCountUp();return;}
  const io=new IntersectionObserver((ents)=>{
    ents.forEach(e=>{ if(e.isIntersecting){ runCountUp(); io.disconnect(); }});
  },{threshold:0.4});
  io.observe(hs);
}

/* Pull catalog + config + session from the backend. Falls back silently to the
   in-code seeds / localStorage when the backend isn't configured. */
async function bootstrapBackend(){
  let b; try{ b=await SDB.bootstrap(); }catch(e){ b=null; }
  if(!b || !b.configured) { BACKEND=false; return; }
  BACKEND=true;
  try{
    if(Array.isArray(b.products) && b.products.length){
      PRODUCTS = b.products;
      PRODUCTS.forEach(syncProductFromVariants);
    }
    if(Array.isArray(b.categories) && b.categories.length) CATEGORIES = b.categories;
    if(b.settings) SETTINGS = Object.assign({}, SETTINGS, b.settings);   // keep default extras (e.g. integrations)
    if(b.cms)      CMS      = Object.assign({}, CMS, b.cms);
    if(Array.isArray(b.homeReviews)) HOME_REVIEWS = b.homeReviews;
    if(b.reviews && typeof b.reviews==='object') REVIEWS = b.reviews;   // product reviews by product id
    CURRENT_USER = b.user || null;
  }catch(e){ console.warn('bootstrap apply failed', e); }
}

async function boot(){
  // persistent overlay + drawer + modal (with ARIA)
  document.body.insertAdjacentHTML('beforeend',`
    <div class="overlay" id="overlay" onclick="closeCart()"></div>
    <aside class="drawer" id="cartDrawer" role="dialog" aria-modal="true" aria-label="Shopping cart" aria-hidden="true">
      <div class="drawer-head"><h3>Your Cart</h3><button class="x" aria-label="Close cart" onclick="closeCart()">×</button></div>
      <div class="drawer-body" id="cartBody"></div>
      <div class="drawer-foot" id="cartFoot"></div>
    </aside>
    <div class="modal" id="modalRoot" aria-hidden="true"></div>`);

  // ---- FIRST PAINT: render the storefront immediately with seed data, WITHOUT waiting
  //      on the network. This kills the "blank screen for a few seconds" (the bootstrap
  //      API call was previously blocking the very first render). ----
  renderSite();
  renderCategoryTiles();  // Shop-by-Category tiles from the live category list
  renderHomeReviews();
  setReviewsEnabled(REVIEWS_ENABLED);
  applyStoreContact();
  initSitePage();        // Home / Shop / About page router
  injectContactDock();
  initRevealObserver();
  watchHeroStats();
  updateCartUI();
  updateAccountUI();
  initConsent();
  checkRoute();
  window.addEventListener('hashchange',checkRoute);

  // ---- HYDRATE: fetch backend data in the background, then refresh the data-driven
  //      parts in place (catalogue, CMS copy, reviews, signed-in state). ----
  bootstrapBackend().then(()=>{
    seedAnalyticsDemo(); track('view');   // client #13: record a page view
    if(BACKEND){
      renderFilters(); renderProducts();            // real catalogue
      renderCategoryTiles();                        // rebuild Shop-by-Category from DB categories
      if(typeof applyCMS==='function') applyCMS();  // announcement / hero / story / returns copy
      applyStoreContact();                          // footer contact from saved settings
      renderHomeReviews(); setReviewsEnabled(REVIEWS_ENABLED);
      updateAccountUI();                            // reflect a restored shopper session
      initRevealObserver();                         // re-arm reveal for refreshed nodes
    }
  }).catch(()=>{}).finally(()=>{
    // The first checkRoute() ran while the backend was still connecting, so /admin
    // showed a neutral loader. Now that bootstrap has resolved (backend OR offline),
    // re-check: restore an existing staff session → dashboard, else show the login.
    BOOTED = true;
    if(location.hash.includes('/admin') && loginStage!=='in') checkRoute();
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeCart();closeModal();closeSearch();}
    // simple focus trap inside open modal
    if(e.key==='Tab'){
      const modal=$("#modalRoot");
      if(modal&&modal.classList.contains('show')){
        const f=modal.querySelectorAll('button,a,input,textarea,select,[tabindex]:not([tabindex="-1"])');
        if(f.length){const first=f[0],last=f[f.length-1];
          if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
          else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
      }
    }
  });
}
boot();
