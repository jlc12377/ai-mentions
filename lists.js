/* Category list and Best-of list links for the free score form.
 * Local categories and covered towns come from localsmallbusinessreviews.com.
 * Town names are coverage on that site, not a location for this company.
 *
 * List link rules:
 * 1. Local category + a city in a covered metro, and that list is published:
 *    the city/metro list on localsmallbusinessreviews.com.
 * 2. Local category + a covered metro whose list is not published:
 *    that metro's category page (the city hub).
 * 3. National category: its existing category rankings page. City is ignored.
 * 4. Anything else (unknown city, blank city, Other): Get verified.
 *    https://listicleliaison.com/pages/pricing.html
 * A local category never falls through to an unrelated national list.
 * A town name in two metros asks for the state. It does not guess a list.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AiLists = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERIFIED_URL = 'https://listicleliaison.com/pages/pricing.html';
  var LOCAL_ORIGIN = 'https://localsmallbusinessreviews.com';

  var categories = {
  "crm": {
    "label": "CRM Software",
    "name": "CRM Software",
    "link": "https://softwareindustryreviews.com/pages/crm-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "pm": {
    "label": "Project Management",
    "name": "Project Management",
    "link": "https://softwareindustryreviews.com/pages/pm-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "cyber": {
    "label": "Cybersecurity",
    "name": "Cybersecurity",
    "link": "https://softwareindustryreviews.com/pages/cyber-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "erp": {
    "label": "ERP Software",
    "name": "ERP Software",
    "link": "https://softwareindustryreviews.com/pages/erp-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "email": {
    "label": "Email Marketing",
    "name": "Email Marketing",
    "link": "https://softwareindustryreviews.com/pages/email-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "hr": {
    "label": "HR & Payroll",
    "name": "HR & Payroll",
    "link": "https://softwareindustryreviews.com/pages/hr-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "accounting": {
    "label": "Accounting",
    "name": "Accounting Software",
    "link": "https://softwareindustryreviews.com/pages/accounting-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "analytics": {
    "label": "Analytics & BI",
    "name": "Analytics & BI",
    "link": "https://softwareindustryreviews.com/pages/analytics-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "ai_chat": {
    "label": "AI Chatbots",
    "name": "AI Chatbots",
    "link": "https://aiindustryreviews.com/pages/chatbot-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "ai_code": {
    "label": "AI Coding Tools",
    "name": "AI Coding Tools",
    "link": "https://aiindustryreviews.com/pages/coding-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "ai_image": {
    "label": "AI Image Generators",
    "name": "AI Image Generators",
    "link": "https://aiindustryreviews.com/pages/image-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "ai_write": {
    "label": "AI Writing Tools",
    "name": "AI Writing Tools",
    "link": "https://aiindustryreviews.com/pages/writing-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "crypto_ex": {
    "label": "Crypto Exchanges",
    "name": "Crypto Exchanges",
    "link": "https://cryptoindustryreviews.com/pages/exchange-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "defi": {
    "label": "DeFi Platforms",
    "name": "DeFi Platforms",
    "link": "https://cryptoindustryreviews.com/pages/defi-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "wallets": {
    "label": "Crypto Wallets",
    "name": "Crypto Wallets",
    "link": "https://cryptoindustryreviews.com/pages/wallet-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "casino": {
    "label": "Online Casinos",
    "name": "Online Casinos",
    "link": "https://casinoindustryreviews.com/pages/casino-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "sports": {
    "label": "Sportsbooks",
    "name": "Sportsbooks",
    "link": "https://casinoindustryreviews.com/pages/sportsbook-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "casino_sw": {
    "label": "Casino Software",
    "name": "Casino Software Providers",
    "link": "https://casinoindustryreviews.com/pages/software-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "ehr": {
    "label": "EHR & Medical Records",
    "name": "EHR & Medical Records",
    "link": "https://healthcareindustryreviews.com/pages/ehr-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "telehealth": {
    "label": "Telehealth Platforms",
    "name": "Telehealth Platforms",
    "link": "https://healthcareindustryreviews.com/pages/telehealth-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "medbilling": {
    "label": "Medical Billing & RCM",
    "name": "Medical Billing & RCM",
    "link": "https://www.healthcareindustryreviews.com/pages/billing-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "clinical": {
    "label": "Clinical Trial Software",
    "name": "Clinical Trial Software",
    "link": "https://healthcareindustryreviews.com/pages/clinical-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "wellness": {
    "label": "Health & Wellness Apps",
    "name": "Health & Wellness Apps",
    "link": "https://healthcareindustryreviews.com/pages/wellness-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "pharma": {
    "label": "Pharma & Biotech Tools",
    "name": "Pharma & Biotech Tools",
    "link": "https://healthcareindustryreviews.com/pages/pharma-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "banking": {
    "label": "Banking & Core Systems",
    "name": "Banking & Core Systems",
    "link": "https://financialindustryreviews.com/pages/banking-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "wealth": {
    "label": "Wealth Management",
    "name": "Wealth Management",
    "link": "https://financialindustryreviews.com/pages/wealth-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "insurtech": {
    "label": "Insurance Technology",
    "name": "Insurance Technology",
    "link": "https://financialindustryreviews.com/pages/insurtech-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "payments": {
    "label": "Payment Platforms",
    "name": "Payment Platforms",
    "link": "https://financialindustryreviews.com/pages/payments-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "lending": {
    "label": "Lending & Mortgage Tech",
    "name": "Lending & Mortgage Tech",
    "link": "https://financialindustryreviews.com/pages/lending-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "regtech": {
    "label": "Compliance & RegTech",
    "name": "Compliance & RegTech",
    "link": "https://financialindustryreviews.com/pages/compliance-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "pr": {
    "label": "PR & Newswire Software",
    "name": "PR & Newswire Software",
    "link": "https://softwareindustryreviews.com/pages/pr-rankings.html",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "other": {
    "label": "Other / Not Listed",
    "name": "your industry",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html"
  },
  "local_pi": {
    "label": "Personal Injury Lawyers",
    "name": "Personal Injury Lawyers",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "personal-injury-lawyers",
    "keywords": "injury attorney, car accident lawyer",
    "section": "Legal"
  },
  "local_divorce": {
    "label": "Divorce Lawyers",
    "name": "Divorce Lawyers",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "divorce-lawyers",
    "keywords": "divorce attorney, family divorce",
    "section": "Legal"
  },
  "local_family": {
    "label": "Family Law Attorneys",
    "name": "Family Law Attorneys",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "family-law-attorneys",
    "keywords": "custody, adoption, family lawyer",
    "section": "Legal"
  },
  "local_estate": {
    "label": "Estate Planning Attorneys",
    "name": "Estate Planning Attorneys",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "estate-planning-attorneys",
    "keywords": "wills, trusts, probate, estate planning lawyer, lawyer",
    "section": "Legal"
  },
  "local_criminal": {
    "label": "Criminal Defense / DUI Attorneys",
    "name": "Criminal Defense / DUI Attorneys",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "criminal-defense-attorneys",
    "keywords": "dui, dwi, criminal lawyer",
    "section": "Legal"
  },
  "local_business_law": {
    "label": "Business Attorneys",
    "name": "Business Attorneys",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "business-attorneys",
    "keywords": "business lawyer, corporate attorney",
    "section": "Legal"
  },
  "local_law_firms": {
    "label": "Law Firms",
    "name": "Law Firms",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "law-firms",
    "keywords": "attorney, lawyer, law firm",
    "section": "Legal"
  },
  "local_aesthetics": {
    "label": "Aesthetics & Injectors",
    "name": "Aesthetics & Injectors",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "aesthetics-injectors",
    "keywords": "brows, brow, lashes, lash, eyelash, eyelashes, lash extensions, brow lamination, pmu, pmu artist, permanent makeup, microblading, lip blush, lip artist, botox, filler, injector, dermatology",
    "section": "Aesthetics"
  },
  "local_medspa": {
    "label": "Medical Spas",
    "name": "Medical Spas",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "med-spas",
    "keywords": "med spa, medspa, medical spa, facial, aesthetics",
    "section": "Aesthetics"
  },
  "local_plastic": {
    "label": "Plastic Surgeons",
    "name": "Plastic Surgeons",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "plastic-surgeons",
    "keywords": "plastic surgery, cosmetic surgeon",
    "section": "Aesthetics"
  },
  "local_dentists": {
    "label": "Dentists",
    "name": "Dentists",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "dentists",
    "keywords": "dental, dentistry, dentist",
    "section": "Dentistry"
  },
  "local_ortho": {
    "label": "Orthodontists",
    "name": "Orthodontists",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "orthodontists",
    "keywords": "braces, invisalign, orthodontist",
    "section": "Dentistry"
  },
  "local_concierge": {
    "label": "Concierge Medicine",
    "name": "Concierge Medicine",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "concierge-medicine",
    "keywords": "concierge doctor, direct primary care",
    "section": "Medical"
  },
  "local_chiro": {
    "label": "Chiropractors & Physical Therapy",
    "name": "Chiropractors & Physical Therapy",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "chiropractors-physical-therapy",
    "keywords": "chiropractor, physical therapy, pt clinic",
    "section": "Medical"
  },
  "local_vets": {
    "label": "Veterinarians",
    "name": "Veterinarians",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "veterinarians",
    "keywords": "vet, veterinary, animal hospital",
    "section": "Veterinary"
  },
  "local_hvac": {
    "label": "HVAC Companies",
    "name": "HVAC Companies",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "hvac",
    "keywords": "heating, air conditioning, ac repair",
    "section": "Home services"
  },
  "local_plumbers": {
    "label": "Plumbers",
    "name": "Plumbers",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "plumbers",
    "keywords": "plumbing, plumber",
    "section": "Home services"
  },
  "local_roofers": {
    "label": "Roofers",
    "name": "Roofers",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "roofers",
    "keywords": "roofing, roofer",
    "section": "Home services"
  },
  "local_remodel": {
    "label": "Home Remodelers",
    "name": "Home Remodelers",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "home-remodelers",
    "keywords": "remodel, remodeling, renovation, kitchen remodel",
    "section": "Home services"
  },
  "local_handyman": {
    "label": "Handyman Services",
    "name": "Handyman Services",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "handyman-services",
    "keywords": "handyman",
    "section": "Home services"
  },
  "local_construction": {
    "label": "Construction Firms",
    "name": "Construction Firms",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "construction-firms",
    "keywords": "contractor, general contractor, builder",
    "section": "Construction"
  },
  "local_re_agents": {
    "label": "Real Estate Agents",
    "name": "Real Estate Agents",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "real-estate-agents",
    "keywords": "realtor, real estate agent",
    "section": "Real estate"
  },
  "local_re_firms": {
    "label": "Real Estate Firms",
    "name": "Real Estate Firms",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "real-estate-firms",
    "keywords": "brokerage, real estate broker",
    "section": "Real estate"
  },
  "local_advisors": {
    "label": "Financial Advisors",
    "name": "Financial Advisors",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "financial-advisors",
    "keywords": "financial advisor, wealth advisor, ria",
    "section": "Financial"
  },
  "local_cpas": {
    "label": "CPAs & Accountants",
    "name": "CPAs & Accountants",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "cpas-accountants",
    "keywords": "cpa, accountant, accounting firm, bookkeeper",
    "section": "Financial"
  },
  "local_marketing": {
    "label": "Marketing Agencies",
    "name": "Marketing Agencies",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "marketing-agencies",
    "keywords": "marketing agency, advertising agency",
    "section": "Marketing"
  },
  "local_weddings": {
    "label": "Wedding Venues",
    "name": "Wedding Venues",
    "link": "",
    "pricing": "https://listicleliaison.com/pages/pricing.html",
    "localSlug": "wedding-venues",
    "keywords": "wedding venue, event venue",
    "section": "Weddings"
  }
};

  var groups = [
    { label: "Software", ids: ["crm", "pm", "cyber", "erp", "email", "hr", "accounting", "analytics"] },
    { label: "AI Tools", ids: ["ai_chat", "ai_code", "ai_image", "ai_write"] },
    { label: "Crypto & Web3", ids: ["crypto_ex", "defi", "wallets"] },
    { label: "Casino & Gaming", ids: ["casino", "sports", "casino_sw"] },
    { label: "Healthcare", ids: ["ehr", "telehealth", "medbilling", "clinical", "wellness", "pharma"] },
    { label: "Financial Services", ids: ["banking", "wealth", "insurtech", "payments", "lending", "regtech"] },
    { label: 'Local services', sections: [
      { label: "Legal", ids: ["local_pi", "local_divorce", "local_family", "local_estate", "local_criminal", "local_business_law", "local_law_firms"] },
      { label: "Aesthetics", ids: ["local_aesthetics", "local_medspa", "local_plastic"] },
      { label: "Dentistry", ids: ["local_dentists", "local_ortho"] },
      { label: "Medical", ids: ["local_concierge", "local_chiro"] },
      { label: "Veterinary", ids: ["local_vets"] },
      { label: "Home services", ids: ["local_hvac", "local_plumbers", "local_roofers", "local_remodel", "local_handyman"] },
      { label: "Construction", ids: ["local_construction"] },
      { label: "Real estate", ids: ["local_re_agents", "local_re_firms"] },
      { label: "Financial", ids: ["local_advisors", "local_cpas"] },
      { label: "Marketing", ids: ["local_marketing"] },
      { label: "Weddings", ids: ["local_weddings"] },
    ] },
    { label: 'Other Industries', ids: ['pr', 'other'] }
  ];

  var metros = {
    "nashville": { state: "tn", towns: ["Berry Hill", "Brentwood", "Columbia", "Franklin", "Gallatin", "Goodlettsville", "Hendersonville", "Hermitage", "La Vergne", "Lascassas", "Lebanon", "Madison", "Mt. Juliet", "Murfreesboro", "Nashville", "Nashville (Green Hills)", "Nolensville", "Old Hickory", "Smyrna", "Spring Hill", "Watertown"] },
    "miami": { state: "fl", towns: ["Aventura", "Coral Gables", "Coral Springs", "Davie", "Doral", "Fort Lauderdale", "Hialeah", "Hollywood", "Homestead", "Key Biscayne", "Miami", "Miami (Coconut Grove)", "Miami (Downtown)", "Miami Beach", "Miami Lakes", "Miami Shores", "Miami Springs", "Miramar", "North Miami", "North Miami Beach", "Oakland Park", "Pembroke Pines", "Pinecrest", "Plantation", "Pompano Beach", "South Miami", "Sunrise", "West Park", "Weston", "Wilton Manors"] },
    "new-york": { state: "ny", towns: ["Baldwin", "Bardonia", "Bayonne", "Bloomfield", "Bronx", "Bronxville", "Brooklyn", "Chappaqua", "Cresskill", "Croton-on-Hudson", "Dobbs Ferry", "East Orange", "Edgewater", "Elizabeth", "Elmsford", "Englewood", "Flushing", "Forest Hills", "Garden City", "Great Neck", "Greenwich", "Hackensack", "Hoboken", "Irvington", "Islip Terrace", "Jackson Heights", "Jamaica", "Jersey City", "Kearny", "Kenilworth", "Linden", "Little Falls", "Livingston", "Long Island City", "Mamaroneck", "Massapequa", "Melville", "Montclair", "Morristown", "Mount Kisco", "Mt. Vernon", "New York", "New York (Manhattan)", "Newark", "North Arlington", "North Bergen", "Nutley", "Orange", "Paramus", "Pearl River", "Pleasantville", "Port Washington", "Queens", "Queens (Kew Gardens)", "Ramsey", "Richmond Hill", "Ridgefield Park", "Ridgewood", "Rockville Centre", "Roslyn", "Rutherford", "Rye Brook", "Scarsdale", "Scotch Plains", "Short Hills", "Sleepy Hollow", "Somers", "Springfield", "Staten Island", "Summit", "Sunnyside", "Union", "Uniondale", "Verona", "Wayne", "Weehawken", "West Orange", "Westfield", "White Plains", "Whitestone", "Woodside", "Wyckoff", "Yonkers", "Yorktown Heights"] },
    "dallas-fort-worth": { state: "tx", towns: ["Addison", "Allen", "Anna", "Argyle", "Arlington", "Aubrey", "Azle", "Bartonville", "Burleson", "Carrollton", "Cedar Hill", "Colleyville", "Coppell", "Cross Roads", "Dallas", "Denton", "Farmers Branch", "Flower Mound", "Forney", "Fort Worth", "Frisco", "Garland", "Grand Prairie", "Grapevine", "Highland Village", "Hurst", "Irving", "Joshua", "Keller", "Lake Dallas", "Lake Worth", "Lavon", "Lewisville", "Little Elm", "Mansfield", "McKinney", "Melissa", "Mesquite", "Midlothian", "North Richland Hills", "Plano", "Princeton", "Prosper", "Richardson", "Rockwall", "Rowlett", "Sachse", "Southlake", "The Colony", "University Park", "Watauga", "Wylie"] },
    "los-angeles": { state: "ca", towns: ["Anaheim", "Anaheim Hills", "Arcadia", "Beverly Hills", "Brea", "Brentwood", "Burbank", "Calabasas", "Canoga Park", "Cerritos", "Chatsworth", "Costa Mesa", "Covina", "Culver City", "Downey", "El Segundo", "Encino", "Fountain Valley", "Fullerton", "Garden Grove", "Glendale", "Granada Hills", "Harbor City", "Hawthorne", "Hermosa Beach", "Huntington Beach", "Irvine", "La Canada Flintridge", "La Crescenta", "La Crescenta-Montrose", "Laguna Hills", "Laguna Niguel", "Lakewood", "Long Beach", "Los Angeles", "Los Angeles (Arts District)", "Los Angeles (Bel Air)", "Los Angeles (Century City)", "Malibu", "Manhattan Beach", "Marina Del Rey", "Mission Viejo", "Monrovia", "Montebello", "Montrose", "Newport Beach", "Orange", "Palmdale", "Pasadena", "Rancho Palos Verdes", "Redondo Beach", "Rolling Hills Estates", "San Fernando", "San Pedro", "Santa Ana", "Santa Fe Springs", "Santa Monica", "Seal Beach", "Sherman Oaks", "South Pasadena", "Studio City", "Sylmar", "Tarzana", "Torrance", "Tujunga", "Tustin", "Valley Glen", "Van Nuys", "Walnut", "West Hollywood", "Westlake Village", "Woodland Hills", "Yorba Linda"] },
    "chicago": { state: "il", towns: ["Addison", "Arlington Heights", "Aurora", "Barrington", "Batavia", "Bensenville", "Berwyn", "Bolingbrook", "Brookfield", "Buffalo Grove", "Carol Stream", "Chicago", "Clarendon Hills", "Crestwood", "Crystal Lake", "Des Plaines", "Downers Grove", "East Dundee", "Elburn", "Elgin", "Elk Grove Village", "Elmhurst", "Evanston", "Frankfort", "Franklin Park", "Geneva", "Glen Ellyn", "Glencoe", "Glenview", "Hanover Park", "Highland Park", "Hillside", "Hinsdale", "Hoffman Estates", "Homewood", "Itasca", "Joliet", "Kildeer", "La Grange", "Lake Bluff", "Lake Forest", "Lake Villa", "Lemont", "Libertyville", "Lincolnshire", "Lincolnwood", "Lisle", "Lockport", "Lombard", "Melrose Park", "Monee", "Montgomery", "Morris", "Morton Grove", "Mt. Prospect", "Naperville", "New Lenox", "Niles", "North Aurora", "Northbrook", "Northfield", "Oak Brook", "Oak Forest", "Oak Park", "Oakbrook Terrace", "Orland Park", "Oswego", "Palatine", "Palos Hills", "Park Ridge", "Plainfield", "Prospect Heights", "Riverside", "Rolling Meadows", "Roselle", "Schaumburg", "Schiller Park", "Skokie", "South Barrington", "St Charles", "Vernon Hills", "Warrenville", "West Chicago", "Wheaton", "Wheeling", "Willowbrook", "Wilmette", "Winfield", "Winnetka", "Woodridge", "Worth", "Yorkville"] },
  };

  var NY_NJ = ["Bayonne", "Bloomfield", "Cresskill", "East Orange", "Edgewater", "Elizabeth", "Englewood", "Hackensack", "Hoboken", "Irvington", "Jersey City", "Kearny", "Kenilworth", "Linden", "Little Falls", "Livingston", "Montclair", "Morristown", "Newark", "North Arlington", "North Bergen", "Nutley", "Orange", "Paramus", "Ramsey", "Ridgefield Park", "Ridgewood", "Rutherford", "Scotch Plains", "Short Hills", "Springfield", "Summit", "Union", "Verona", "Wayne", "Weehawken", "West Orange", "Westfield", "Wyckoff"];
  var NY_CT = ['Greenwich'];

  var extraAliases = [
    { metro: 'dallas-fort-worth', name: 'dfw', state: 'tx' },
    { metro: 'dallas-fort-worth', name: 'dallas fort worth', state: 'tx' },
    { metro: 'new-york', name: 'nyc', state: 'ny' },
    { metro: 'new-york', name: 'new york city', state: 'ny' },
    { metro: 'los-angeles', name: 'la', state: 'ca' },
    { metro: 'los-angeles', name: 'l a', state: 'ca' }
  ];

  var unpublished = {
    "chicago|chiropractors-physical-therapy": true,
    "dallas-fort-worth|chiropractors-physical-therapy": true,
    "dallas-fort-worth|concierge-medicine": true,
    "los-angeles|chiropractors-physical-therapy": true,
    "los-angeles|med-spas": true,
    "miami|chiropractors-physical-therapy": true,
    "miami|concierge-medicine": true,
  };


  var STATE_NAMES = {
    tennessee: 'tn',
    florida: 'fl',
    texas: 'tx',
    california: 'ca',
    illinois: 'il',
    'new jersey': 'nj',
    connecticut: 'ct',
    'new york': 'ny'
  };
  var STATE_ABBR = { tn: 'tn', fl: 'fl', tx: 'tx', ca: 'ca', il: 'il', ny: 'ny', nj: 'nj', ct: 'ct' };
  var STATE_LABELS = {
    tn: 'Tennessee',
    fl: 'Florida',
    tx: 'Texas',
    ca: 'California',
    il: 'Illinois',
    ny: 'New York',
    nj: 'New Jersey',
    ct: 'Connecticut'
  };

  function normalize(raw) {
    return String(raw || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[’']/g, '')
      .replace(/\./g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\bmt\b/g, 'mount')
      .replace(/\bst\b/g, 'saint')
      .replace(/\bft\b/g, 'fort')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parsePlace(raw) {
    var text = normalize(raw)
      .replace(/^(greater|metro)\s+/, '')
      .replace(/\s+(metro|area|region)$/, '')
      .trim();
    if (!text) return { city: '', state: '' };
    var names = ['tennessee', 'florida', 'texas', 'california', 'illinois', 'new jersey', 'connecticut', 'new york'];
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (text.length > name.length + 1 && text.slice(-(name.length + 1)) === ' ' + name) {
        return { city: text.slice(0, -(name.length + 1)).trim(), state: STATE_NAMES[name] };
      }
    }
    var parts = text.split(' ');
    var last = parts[parts.length - 1];
    if (parts.length > 1 && STATE_ABBR[last]) {
      return { city: parts.slice(0, -1).join(' '), state: STATE_ABBR[last] };
    }
    return { city: text, state: '' };
  }

  function baseAndInner(label) {
    var match = /^(.*)\((.*)\)\s*$/.exec(String(label || ''));
    if (!match) return { base: label, inner: '' };
    return { base: match[1].trim(), inner: match[2].trim() };
  }

  var njSet = {};
  NY_NJ.forEach(function (name) { njSet[normalize(name)] = true; });
  var ctSet = {};
  NY_CT.forEach(function (name) { ctSet[normalize(name)] = true; });

  function stateFor(metro, label) {
    var parts = baseAndInner(label);
    var base = normalize(parts.base);
    if (metro === 'new-york') {
      if (ctSet[base]) return 'ct';
      if (njSet[base]) return 'nj';
      return 'ny';
    }
    return metros[metro].state;
  }

  var byName = {};
  function addAlias(metro, name, state) {
    var key = normalize(name);
    if (!key) return;
    if (!byName[key]) byName[key] = [];
    for (var i = 0; i < byName[key].length; i++) {
      if (byName[key][i].metro === metro && byName[key][i].state === state) return;
    }
    byName[key].push({ metro: metro, state: state });
  }

  Object.keys(metros).forEach(function (metro) {
    metros[metro].towns.forEach(function (label) {
      var parts = baseAndInner(label);
      var state = stateFor(metro, label);
      addAlias(metro, parts.base, state);
      var inner = normalize(parts.inner);
      if (inner && inner !== 'downtown' && inner !== 'midtown' && inner !== 'uptown') {
        addAlias(metro, parts.inner, state);
      }
    });
  });
  extraAliases.forEach(function (alias) {
    addAlias(alias.metro, alias.name, alias.state);
  });

  function matchMetro(city) {
    var parsed = parsePlace(city);
    if (!parsed.city) return null;
    var hits = byName[parsed.city] || [];
    if (parsed.state) {
      var exact = hits.filter(function (hit) { return hit.state === parsed.state; });
      return exact.length === 1 ? exact[0].metro : null;
    }
    var found = [];
    hits.forEach(function (hit) {
      if (found.indexOf(hit.metro) === -1) found.push(hit.metro);
    });
    return found.length === 1 ? found[0] : null;
  }

  function category(key) {
    var cat = categories[key];
    if (!cat) return null;
    return {
      key: key,
      label: cat.label,
      name: cat.name,
      link: cat.link || '',
      pricing: cat.pricing || VERIFIED_URL,
      localSlug: cat.localSlug || '',
      keywords: cat.keywords || ''
    };
  }

  function findByName(text) {
    var wanted = String(text || '').trim().toLowerCase();
    if (!wanted) return null;
    var keys = Object.keys(categories);
    for (var i = 0; i < keys.length; i++) {
      var cat = categories[keys[i]];
      if (cat.label.toLowerCase() === wanted || cat.name.toLowerCase() === wanted) return category(keys[i]);
    }
    return null;
  }

  function localListUrl(metro, slug) {
    return LOCAL_ORIGIN + '/' + metro + '/best-' + slug + '-' + metro + '.html';
  }

  function metroHubUrl(metro) {
    return LOCAL_ORIGIN + '/' + metro + '/';
  }

  function destinationForMetro(cat, metro) {
    if (unpublished[metro + '|' + cat.localSlug]) {
      return { href: metroHubUrl(metro), kind: 'metro', metro: metro };
    }
    return { href: localListUrl(metro, cat.localSlug), kind: 'local', metro: metro };
  }

  // Town names that sit in two covered metros (Brentwood, Orange, Addison).
  // A state on the city picks one. Without a state, return every match so
  // the page can ask, instead of sending the visitor to the pricing page.
  function ambiguousHits(city) {
    var parsed = parsePlace(city);
    if (!parsed.city || parsed.state) return [];
    var hits = byName[parsed.city] || [];
    var found = [];
    hits.forEach(function (hit) {
      if (found.some(function (row) { return row.metro === hit.metro; })) return;
      found.push(hit);
    });
    return found.length > 1 ? found : [];
  }

  function listDestination(key, city) {
    var cat = category(key);
    if (!cat) return { href: VERIFIED_URL, kind: 'verified', metro: null };
    if (cat.localSlug) {
      var ambiguous = ambiguousHits(city);
      if (ambiguous.length > 1) {
        return {
          href: '',
          kind: 'choose',
          metro: null,
          choices: ambiguous.map(function (hit) {
            var picked = destinationForMetro(cat, hit.metro);
            return {
              metro: hit.metro,
              state: hit.state,
              label: STATE_LABELS[hit.state] || hit.state.toUpperCase(),
              href: picked.href,
              kind: picked.kind
            };
          })
        };
      }
      var metro = matchMetro(city);
      if (!metro) return { href: VERIFIED_URL, kind: 'verified', metro: null };
      return destinationForMetro(cat, metro);
    }
    if (key === 'other' || !cat.link) return { href: VERIFIED_URL, kind: 'verified', metro: null };
    return { href: cat.link, kind: 'category', metro: null };
  }

  function search(query) {
    var terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    var results = [];
    groups.forEach(function (group) {
      var sections = group.sections && group.sections.length ? group.sections : [{ label: '', ids: group.ids || [] }];
      sections.forEach(function (section) {
        (section.ids || []).forEach(function (id) {
          var cat = category(id);
          if (!cat) return;
          var hay = (cat.label + ' ' + cat.name + ' ' + cat.keywords + ' ' + group.label + ' ' + (section.label || '')).toLowerCase();
          if (terms.every(function (term) { return hay.indexOf(term) !== -1; })) {
            results.push({ key: id, group: group.label, section: section.label || '' });
          }
        });
      });
    });
    return results;
  }

  return {
    VERIFIED_URL: VERIFIED_URL,
    LOCAL_ORIGIN: LOCAL_ORIGIN,
    groups: groups,
    category: category,
    findByName: findByName,
    matchMetro: matchMetro,
    listDestination: listDestination,
    search: search
  };
});

