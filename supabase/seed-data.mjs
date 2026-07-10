// Canonical Suddhalaya seed data — extracted verbatim from the storefront engine.
// Used by supabase/seed.mjs to populate the database. Keep in sync with the catalog.

export const CATS = [
  {name:"A2 Dairy", sub:"Bilona Ghee", c1:"#1f3520", c2:"#2d4a2e", cats:["A2 Dairy"]},
  {name:"Cold-Pressed Oils", sub:"Wood-Pressed", c1:"#3a4718", c2:"#56682a", cats:["Cold-Pressed Oils"]},
  {name:"Honey", sub:"Raw & Wild", c1:"#6b4a1e", c2:"#8a6428", cats:["Honey"]},
  {name:"Staples & Spices", sub:"Stone-Ground", c1:"#7a3f3a", c2:"#9a5450", cats:["Staples","Spices"]},
];

export const CATEGORIES = [
  {id:1,name:"A2 Dairy",slug:"a2-dairy",seo:"Bilona A2 ghee & dairy",order:1},
  {id:2,name:"Cold-Pressed Oils",slug:"cold-pressed-oils",seo:"Wood-pressed cooking oils",order:2},
  {id:3,name:"Honey",slug:"honey",seo:"Raw & wild honey",order:3},
  {id:4,name:"Staples",slug:"staples",seo:"Stone-ground staples",order:4},
  {id:5,name:"Spices",slug:"spices",seo:"Single-origin spices",order:5}
];

export const COUPONS = {
  "PURE10":{type:"pct",value:10,desc:"10% off",active:true,uses:42,cap:0,expires:"31 Dec 2026",minCart:0},
  "FIRST100":{type:"flat",value:100,desc:"₹100 off first order",active:true,uses:128,cap:0,expires:"31 Dec 2026",minCart:499},
  "GHEE15":{type:"pct",value:15,desc:"15% off ghee",active:true,uses:17,cap:200,expires:"31 Aug 2026",minCart:0}
};

export const CUSTOMERS = [
  {id:1,name:"Ananya R.",email:"ananya.r@email.com",phone:"9845012345",city:"Bengaluru",since:"12 Jan 2026",tags:["VIP"]},
  {id:2,name:"Vikram S.",email:"vikram.s@email.com",phone:"9812345678",city:"Bengaluru",since:"03 Feb 2026",tags:[]},
  {id:3,name:"Meera K.",email:"meera.k@email.com",phone:"9900123456",city:"Chennai",since:"21 Nov 2025",tags:["Repeat"]},
  {id:4,name:"Rahul T.",email:"rahul.t@email.com",phone:"9765432109",city:"Noida",since:"18 Mar 2026",tags:[]},
  {id:5,name:"Pooja N.",email:"pooja.n@email.com",phone:"9871203456",city:"Kochi",since:"29 Apr 2026",tags:["Repeat"]}
];

export const PRODUCTS = [
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

export const ORDERS = [
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
