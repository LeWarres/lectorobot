const test = require('node:test')
const assert = require('node:assert/strict')
const { companyLogoUrl, infoboxLogo, cleanName, HEADERS } = require('./companies.cjs')

test('busca el logo de la empresa en Wikidata y se identifica', async () => {
  const seen = []
  const fetchImpl = async (url, options) => {
    seen.push(options.headers['User-Agent'])
    if (url.includes('wbsearchentities')) return { ok: true, json: async () => ({ search: [{ id: 'Q1' }, { id: 'Q2' }, { id: 'malo' }] }) }
    assert.match(url, /ids=Q1\|Q2&/)
    return { ok: true, json: async () => ({ entities: {
      Q1: { descriptions: { en: { value: 'river in France' } }, claims: { P154: [{ mainsnak: { datavalue: { value: 'Rio.svg' } } }] } },
      Q2: { descriptions: { en: { value: 'Japanese video game publisher' } }, claims: { P154: [{ mainsnak: { datavalue: { value: 'Capcom logo.svg' } } }] } }
    } }) }
  }
  assert.equal(await companyLogoUrl('Capcom', { fetchImpl }), 'https://commons.wikimedia.org/wiki/Special:FilePath/Capcom%20logo.svg?width=320')
  assert.ok(seen.every(agent => agent === HEADERS['User-Agent']))
})

test('si Wikidata no tiene el logo, lo toma de la ficha de Wikipedia', async () => {
  const fetchImpl = async url => ({ ok: true, json: async () => url.includes('wikidata') ? { search: [] } : { parse: { wikitext: '{{Infobox company\n| name = PlatinumGames\n| logo = [[File:PlatinumGames Inc..png|250px]]\n}}' } } })
  assert.equal(await companyLogoUrl('PlatinumGames', { fetchImpl, gapMs: 1 }), 'https://en.wikipedia.org/wiki/Special:FilePath/PlatinumGames%20Inc..png?width=320')
  assert.equal(infoboxLogo('| logo = Team17 logo (2018).svg\n| type = Public'), 'Team17 logo (2018).svg')
  assert.equal(infoboxLogo('| logo = \n| image = Edificio.jpg'), null)
})

test('sin resultados o sin logo devuelve null', async () => {
  assert.equal(await companyLogoUrl('', {}), null)
  assert.equal(await companyLogoUrl('Nadie', { fetchImpl: async () => ({ ok: true, json: async () => ({ search: [] }) }), gapMs: 1 }), null)
  let calls = 0
  const busy = async () => { calls++; return calls < 3 ? { ok: false, status: 429, headers: { get: () => '0.01' } } : { ok: true, json: async () => ({ search: [] }) } }
  assert.equal(await companyLogoUrl('X', { fetchImpl: busy, gapMs: 1 }), null) // reintenta tras el 429
  assert.equal(calls, 4) // dos 429, la búsqueda en Wikidata y la de Wikipedia
  await assert.rejects(companyLogoUrl('X', { fetchImpl: async () => ({ ok: false, status: 503 }), gapMs: 1 }), /503/)
})

test('busca sin forma jurídica y usa el artículo que enlaza Wikidata', async () => {
  assert.equal(cleanName('PlayStation Publishing LLC (excluding China)'), 'PlayStation Publishing')
  assert.equal(cleanName('CAPCOM Co., Ltd.'), 'CAPCOM')
  assert.equal(cleanName('COGNOSPHERE PTE. LTD.'), 'COGNOSPHERE')
  assert.equal(cleanName('Bandai Namco Studio Inc'), 'Bandai Namco Studio')
  assert.equal(cleanName('Team Cherry'), 'Team Cherry')
  let page
  const fetchImpl = async url => ({ ok: true, json: async () => {
    if (url.includes('wbsearchentities')) return { search: [{ id: 'Q5' }] }
    if (url.includes('wbgetentities')) return { entities: { Q5: { descriptions: { en: { value: 'Japanese video game developer' } }, claims: {}, sitelinks: { enwiki: { title: 'Kojima Productions' } } } } }
    page = decodeURIComponent(url.match(/page=([^&]+)/)[1])
    return { parse: { wikitext: '| logo = Kojima Productions logo.svg' } }
  } })
  assert.match(await companyLogoUrl('KOJIMA PRODUCTIONS', { fetchImpl, gapMs: 1 }), /Kojima%20Productions%20logo\.svg/)
  assert.equal(page, 'Kojima Productions')
})
