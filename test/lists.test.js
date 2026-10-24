'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateInput, buildPrompts } = require('../lib/score');
const lists = require('../lists');

const VERIFIED = 'https://listicleliaison.com/pages/pricing.html';

const NATIONAL = {
  crm: ['CRM Software', 'CRM Software', 'https://softwareindustryreviews.com/pages/crm-rankings.html'],
  pm: ['Project Management', 'Project Management', 'https://softwareindustryreviews.com/pages/pm-rankings.html'],
  cyber: ['Cybersecurity', 'Cybersecurity', 'https://softwareindustryreviews.com/pages/cyber-rankings.html'],
  erp: ['ERP Software', 'ERP Software', 'https://softwareindustryreviews.com/pages/erp-rankings.html'],
  email: ['Email Marketing', 'Email Marketing', 'https://softwareindustryreviews.com/pages/email-rankings.html'],
  hr: ['HR & Payroll', 'HR & Payroll', 'https://softwareindustryreviews.com/pages/hr-rankings.html'],
  accounting: ['Accounting', 'Accounting Software', 'https://softwareindustryreviews.com/pages/accounting-rankings.html'],
  analytics: ['Analytics & BI', 'Analytics & BI', 'https://softwareindustryreviews.com/pages/analytics-rankings.html'],
  ai_chat: ['AI Chatbots', 'AI Chatbots', 'https://aiindustryreviews.com/pages/chatbot-rankings.html'],
  ai_code: ['AI Coding Tools', 'AI Coding Tools', 'https://aiindustryreviews.com/pages/coding-rankings.html'],
  ai_image: ['AI Image Generators', 'AI Image Generators', 'https://aiindustryreviews.com/pages/image-rankings.html'],
  ai_write: ['AI Writing Tools', 'AI Writing Tools', 'https://aiindustryreviews.com/pages/writing-rankings.html'],
  crypto_ex: ['Crypto Exchanges', 'Crypto Exchanges', 'https://cryptoindustryreviews.com/pages/exchange-rankings.html'],
  defi: ['DeFi Platforms', 'DeFi Platforms', 'https://cryptoindustryreviews.com/pages/defi-rankings.html'],
  wallets: ['Crypto Wallets', 'Crypto Wallets', 'https://cryptoindustryreviews.com/pages/wallet-rankings.html'],
  casino: ['Online Casinos', 'Online Casinos', 'https://casinoindustryreviews.com/pages/casino-rankings.html'],
  sports: ['Sportsbooks', 'Sportsbooks', 'https://casinoindustryreviews.com/pages/sportsbook-rankings.html'],
  casino_sw: ['Casino Software', 'Casino Software Providers', 'https://casinoindustryreviews.com/pages/software-rankings.html'],
  ehr: ['EHR & Medical Records', 'EHR & Medical Records', 'https://healthcareindustryreviews.com/pages/ehr-rankings.html'],
  telehealth: ['Telehealth Platforms', 'Telehealth Platforms', 'https://healthcareindustryreviews.com/pages/telehealth-rankings.html'],
  medbilling: ['Medical Billing & RCM', 'Medical Billing & RCM', 'https://www.healthcareindustryreviews.com/pages/billing-rankings.html'],
  clinical: ['Clinical Trial Software', 'Clinical Trial Software', 'https://healthcareindustryreviews.com/pages/clinical-rankings.html'],
  wellness: ['Health & Wellness Apps', 'Health & Wellness Apps', 'https://healthcareindustryreviews.com/pages/wellness-rankings.html'],
  pharma: ['Pharma & Biotech Tools', 'Pharma & Biotech Tools', 'https://healthcareindustryreviews.com/pages/pharma-rankings.html'],
  banking: ['Banking & Core Systems', 'Banking & Core Systems', 'https://financialindustryreviews.com/pages/banking-rankings.html'],
  wealth: ['Wealth Management', 'Wealth Management', 'https://financialindustryreviews.com/pages/wealth-rankings.html'],
  insurtech: ['Insurance Technology', 'Insurance Technology', 'https://financialindustryreviews.com/pages/insurtech-rankings.html'],
  payments: ['Payment Platforms', 'Payment Platforms', 'https://financialindustryreviews.com/pages/payments-rankings.html'],
  lending: ['Lending & Mortgage Tech', 'Lending & Mortgage Tech', 'https://financialindustryreviews.com/pages/lending-rankings.html'],
  regtech: ['Compliance & RegTech', 'Compliance & RegTech', 'https://financialindustryreviews.com/pages/compliance-rankings.html'],
  pr: ['PR & Newswire Software', 'PR & Newswire Software', 'https://softwareindustryreviews.com/pages/pr-rankings.html'],
  other: ['Other / Not Listed', 'your industry', '']
};

const LOCAL = [
  ['local_pi', 'Personal Injury Lawyers', 'personal-injury-lawyers'],
  ['local_divorce', 'Divorce Lawyers', 'divorce-lawyers'],
  ['local_family', 'Family Law Attorneys', 'family-law-attorneys'],
  ['local_estate', 'Estate Planning Attorneys', 'estate-planning-attorneys'],
  ['local_criminal', 'Criminal Defense / DUI Attorneys', 'criminal-defense-attorneys'],
  ['local_business_law', 'Business Attorneys', 'business-attorneys'],
  ['local_law_firms', 'Law Firms', 'law-firms'],
  ['local_aesthetics', 'Aesthetics & Injectors', 'aesthetics-injectors'],
  ['local_medspa', 'Medical Spas', 'med-spas'],
  ['local_plastic', 'Plastic Surgeons', 'plastic-surgeons'],
  ['local_dentists', 'Dentists', 'dentists'],
  ['local_ortho', 'Orthodontists', 'orthodontists'],
  ['local_concierge', 'Concierge Medicine', 'concierge-medicine'],
  ['local_chiro', 'Chiropractors & Physical Therapy', 'chiropractors-physical-therapy'],
  ['local_vets', 'Veterinarians', 'veterinarians'],
  ['local_hvac', 'HVAC Companies', 'hvac'],
  ['local_plumbers', 'Plumbers', 'plumbers'],
  ['local_roofers', 'Roofers', 'roofers'],
  ['local_remodel', 'Home Remodelers', 'home-remodelers'],
  ['local_handyman', 'Handyman Services', 'handyman-services'],
  ['local_construction', 'Construction Firms', 'construction-firms'],
  ['local_re_agents', 'Real Estate Agents', 'real-estate-agents'],
  ['local_re_firms', 'Real Estate Firms', 'real-estate-firms'],
  ['local_advisors', 'Financial Advisors', 'financial-advisors'],
  ['local_cpas', 'CPAs & Accountants', 'cpas-accountants'],
  ['local_marketing', 'Marketing Agencies', 'marketing-agencies'],
  ['local_weddings', 'Wedding Venues', 'wedding-venues']
];

function groupKeys() {
  const keys = [];
  for (const group of lists.groups) {
    const sections = group.sections || [{ ids: group.ids }];
    for (const section of sections) keys.push(...section.ids);
  }
  return keys;
}

test('national categories keep their names and rankings pages', () => {
  for (const [key, [label, name, link]] of Object.entries(NATIONAL)) {
    const cat = lists.category(key);
    assert.equal(cat.label, label);
    assert.equal(cat.name, name);
    assert.equal(cat.link, link);
    assert.equal(cat.localSlug, '');
  }
  for (const key of Object.keys(NATIONAL)) {
    assert.equal(lists.category(key).pricing, VERIFIED);
  }
});

test('every localsmallbusinessreviews.com category is in Local services', () => {
  const localGroup = lists.groups.find((group) => group.label === 'Local services');
  assert.ok(localGroup);
  const ids = localGroup.sections.flatMap((section) => section.ids);
  assert.deepEqual(ids, LOCAL.map((row) => row[0]));
  for (const [key, label, slug] of LOCAL) {
    const cat = lists.category(key);
    assert.equal(cat.label, label);
    assert.equal(cat.name, label);
    assert.equal(cat.localSlug, slug);
    assert.equal(cat.pricing, VERIFIED);
    assert.ok(cat.name.length <= 80);
  }
  const aesthetics = lists.category('local_aesthetics');
  assert.match(aesthetics.keywords, /brows/);
  assert.match(aesthetics.keywords, /permanent makeup/);
  assert.equal(new Set(groupKeys()).size, groupKeys().length);
  assert.equal(groupKeys().length, Object.keys(NATIONAL).length + LOCAL.length);
});

test('Franklin, TN aesthetics maps to the Nashville list', () => {
  assert.equal(lists.matchMetro('Franklin, TN'), 'nashville');
  assert.equal(lists.matchMetro('Franklin TN'), 'nashville');
  assert.equal(lists.matchMetro('Franklin, Tennessee'), 'nashville');
  assert.equal(lists.matchMetro('franklin'), 'nashville');
  assert.equal(lists.matchMetro('Franklin, MA'), null);
  const dest = lists.listDestination('local_aesthetics', 'Franklin, TN');
  assert.deepEqual(dest, {
    href: 'https://localsmallbusinessreviews.com/nashville/best-aesthetics-injectors-nashville.html',
    kind: 'local',
    metro: 'nashville'
  });
  assert.equal(dest.href.includes('healthcareindustryreviews'), false);
  assert.equal(dest.href.includes('wellness'), false);
});

test('a local category with no covered city goes to Get verified', () => {
  for (const city of ['', '   ', 'Boston', 'Boston, MA', 'Austin, TX']) {
    const dest = lists.listDestination('local_aesthetics', city);
    assert.equal(dest.kind, 'verified');
    assert.equal(dest.href, VERIFIED);
  }
  assert.deepEqual(lists.listDestination('other', 'Nashville'), {
    href: VERIFIED,
    kind: 'verified',
    metro: null
  });
});

test('national categories keep their own list and ignore city', () => {
  const crm = lists.listDestination('crm', 'Franklin, TN');
  assert.equal(crm.kind, 'category');
  assert.equal(crm.href, 'https://softwareindustryreviews.com/pages/crm-rankings.html');
  const wellness = lists.listDestination('wellness', 'Franklin, TN');
  assert.equal(wellness.href, 'https://healthcareindustryreviews.com/pages/wellness-rankings.html');
});

test('unpublished local lists use the metro category page', () => {
  assert.deepEqual(lists.listDestination('local_medspa', 'Los Angeles, CA'), {
    href: 'https://localsmallbusinessreviews.com/los-angeles/',
    kind: 'metro',
    metro: 'los-angeles'
  });
  assert.deepEqual(lists.listDestination('local_medspa', 'Nashville'), {
    href: 'https://localsmallbusinessreviews.com/nashville/best-med-spas-nashville.html',
    kind: 'local',
    metro: 'nashville'
  });
  assert.equal(lists.listDestination('local_chiro', 'Miami, FL').kind, 'metro');
  assert.equal(lists.listDestination('local_chiro', 'Nashville, TN').href, 'https://localsmallbusinessreviews.com/nashville/best-chiropractors-physical-therapy-nashville.html');
  assert.equal(lists.listDestination('local_concierge', 'Dallas').kind, 'metro');
  assert.equal(lists.listDestination('local_concierge', 'Chicago, IL').kind, 'local');
});

test('covered towns resolve to the right metro, and shared names do not guess', () => {
  assert.equal(lists.matchMetro('Plano, TX'), 'dallas-fort-worth');
  assert.equal(lists.matchMetro('DFW'), 'dallas-fort-worth');
  assert.equal(lists.matchMetro('Brooklyn'), 'new-york');
  assert.equal(lists.matchMetro('Hoboken, NJ'), 'new-york');
  assert.equal(lists.matchMetro('Greenwich, CT'), 'new-york');
  assert.equal(lists.matchMetro('LA'), 'los-angeles');
  assert.equal(lists.matchMetro('NYC'), 'new-york');
  assert.equal(lists.matchMetro('Mt. Juliet, TN'), 'nashville');
  assert.equal(lists.matchMetro('La Vergne'), 'nashville');
  assert.equal(lists.matchMetro('Brentwood'), null);
  assert.equal(lists.matchMetro('Brentwood, TN'), 'nashville');
  assert.equal(lists.matchMetro('Brentwood, CA'), 'los-angeles');
  assert.equal(lists.matchMetro('Addison'), null);
  assert.equal(lists.matchMetro('Addison, IL'), 'chicago');
  assert.equal(lists.matchMetro('Addison, TX'), 'dallas-fort-worth');
  assert.equal(lists.matchMetro('Orange'), null);
  assert.equal(lists.matchMetro('Orange, NJ'), 'new-york');
  assert.equal(lists.matchMetro('Orange, CA'), 'los-angeles');
  assert.equal(lists.listDestination('local_plumbers', 'Plano').href, 'https://localsmallbusinessreviews.com/dallas-fort-worth/best-plumbers-dallas-fort-worth.html');
});

test('shared town names ask for a state instead of the pricing page', () => {
  for (const city of ['Brentwood', 'Orange', 'Addison']) {
    const dest = lists.listDestination('local_aesthetics', city);
    assert.equal(dest.kind, 'choose');
    assert.equal(dest.href, '');
    assert.equal(dest.metro, null);
    assert.equal(dest.choices.length, 2);
    for (const choice of dest.choices) {
      assert.equal(choice.href.includes('listicleliaison.com'), false);
      assert.equal(choice.href.includes('healthcareindustryreviews'), false);
    }
  }
  const brentwood = lists.listDestination('local_aesthetics', 'Brentwood');
  const tn = brentwood.choices.find((choice) => choice.state === 'tn');
  const ca = brentwood.choices.find((choice) => choice.state === 'ca');
  assert.equal(tn.label, 'Tennessee');
  assert.equal(tn.href, 'https://localsmallbusinessreviews.com/nashville/best-aesthetics-injectors-nashville.html');
  assert.equal(ca.label, 'California');
  assert.equal(ca.href, 'https://localsmallbusinessreviews.com/los-angeles/best-aesthetics-injectors-los-angeles.html');
  const orange = lists.listDestination('local_plumbers', 'Orange');
  assert.equal(orange.choices.find((choice) => choice.state === 'nj').metro, 'new-york');
  assert.equal(orange.choices.find((choice) => choice.state === 'ca').metro, 'los-angeles');
  const addison = lists.listDestination('local_plumbers', 'Addison');
  assert.equal(addison.choices.find((choice) => choice.state === 'tx').metro, 'dallas-fort-worth');
  assert.equal(addison.choices.find((choice) => choice.state === 'il').metro, 'chicago');
  const laMedspa = lists.listDestination('local_medspa', 'Orange').choices.find((choice) => choice.state === 'ca');
  assert.equal(laMedspa.kind, 'metro');
  assert.equal(laMedspa.href, 'https://localsmallbusinessreviews.com/los-angeles/');
  assert.equal(lists.listDestination('crm', 'Brentwood').href, 'https://softwareindustryreviews.com/pages/crm-rankings.html');
  assert.equal(lists.listDestination('local_aesthetics', 'Brentwood, TN').kind, 'local');
});

test('category search finds aesthetics aliases and estate planning for lawyer', () => {
  function keys(query) {
    return lists.search(query).map((row) => row.key);
  }
  for (const query of ['pmu', 'PMU artist', 'eyelash', 'lash extensions', 'brow lamination']) {
    assert.ok(keys(query).includes('local_aesthetics'), query);
  }
  const lawyer = keys('lawyer');
  assert.ok(lawyer.includes('local_estate'));
  assert.ok(lawyer.includes('local_pi'));
  assert.ok(lawyer.includes('local_law_firms'));
  assert.equal(lawyer.includes('local_aesthetics'), false);
});

test('local category names still go through the score prompts', () => {
  const input = validateInput({
    businessName: 'Natural Brows by Jenn',
    category: 'Aesthetics & Injectors',
    city: 'Franklin, TN',
    domain: 'example.com'
  });
  assert.equal(input.category, 'Aesthetics & Injectors');
  assert.equal(input.city, 'Franklin, TN');
  const prompts = buildPrompts(input.category, input.city, 3);
  assert.match(prompts[0], /Aesthetics & Injectors/);
  assert.match(prompts[0], /Franklin, TN/);
  for (const [, label] of LOCAL) {
    const scored = validateInput({ businessName: 'Example Co', category: label, city: 'Nashville' });
    assert.equal(scored.category, label);
  }
});
