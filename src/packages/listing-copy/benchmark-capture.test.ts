import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseRakutenResults,
  deriveTargetProfile,
  computeContentHash,
} from './benchmark-capture.js';

const searchResultsFixture = `<!DOCTYPE html>
<html lang="ja">
<head><title>検索結果</title></head>
<body>
<div class="search-results">
  <div class="dui-card searchresultitem">
    <div class="image">
      <a href="https://item.rakuten.co.jp/sofashop/sofa-001/?scid=we_lne_upc138">
        <img src="//thumbnail.image.rakuten.co.jp/@0_mall/sofashop/cabinet/sofa-001.jpg" alt="電動リクライニングソファ 2人掛け 本革">
      </a>
    </div>
    <div class="content">
      <h2 class="title">
        <a href="https://item.rakuten.co.jp/sofashop/sofa-001/?scid=we_lne_upc138">電動リクライニングソファ 2人掛け 本革 ブラウン</a>
      </h2>
      <div class="price"><span>¥</span>49,800</div>
      <div class="shop">
        <a href="https://www.rakuten.co.jp/sofashop/">ソファ専門店</a>
      </div>
      <div class="rating">
        <span class="star">★</span> 4.2
        <span class="review">（128件）</span>
      </div>
    </div>
  </div>

  <div class="dui-card searchresultitem sponsored">
    <div class="image">
      <a href="https://item.rakuten.co.jp/spamshop/spam-999/?scid=sp">
        <img src="//thumbnail.image.rakuten.co.jp/@0_mall/spamshop/cabinet/spam.jpg" alt="広告商品">
      </a>
    </div>
    <div class="content">
      <h2 class="title">
        <a href="https://item.rakuten.co.jp/spamshop/spam-999/">【広告】激安ソファ 1万円</a>
      </h2>
      <div class="price"><span>¥</span>9,999</div>
      <div class="shop">
        <a href="https://www.rakuten.co.jp/spamshop/">激安家具</a>
      </div>
    </div>
  </div>

  <div class="dui-card searchresultitem">
    <div class="image">
      <a href="https://item.rakuten.co.jp/furniture-plus/rc-200/?scid=we_lne_upc200">
        <img src="//thumbnail.image.rakuten.co.jp/@0_mall/furniture-plus/cabinet/rc-200.jpg" alt="リクライニングチェア オットマン付き">
      </a>
    </div>
    <div class="content">
      <h2 class="title">
        <a href="https://item.rakuten.co.jp/furniture-plus/rc-200/">リクライニングチェア オットマン付き 電動 布張り</a>
      </h2>
      <div class="price"><span>¥</span>32,500</div>
      <div class="shop">
        <a href="https://www.rakuten.co.jp/furniture-plus/">Furniture Plus</a>
      </div>
      <div class="review">（52件）</div>
    </div>
  </div>

  <div class="dui-card searchresultitem">
    <div class="image">
      <a href="https://item.rakuten.co.jp/interior-mart/is-800/?scid=we_lne_upc800">
        <img src="//thumbnail.image.rakuten.co.jp/@0_mall/interior-mart/cabinet/is-800.jpg" alt="1人掛け電動ソファ コンパクト">
      </a>
    </div>
    <div class="content">
      <h2 class="title">
        <a href="https://item.rakuten.co.jp/interior-mart/is-800/">1人掛け電動ソファ コンパクト 一人暮らし おしゃれ 小型</a>
      </h2>
      <div class="price"><span>¥</span>19,800</div>
      <div class="shop">
        <a href="https://www.rakuten.co.jp/interior-mart/">インテリアマート</a>
      </div>
      <div class="review">（245件）</div>
    </div>
  </div>
</div>
</body>
</html>`;

test('parseRakutenResults extracts non-sponsored product cards', () => {
  const items = parseRakutenResults(searchResultsFixture, 10);

  assert.ok(items.length === 3, `expected 3 non-sponsored items, got ${items.length}`);

  const [first, second, third] = items;

  assert.equal(first.externalListingId, 'sofashop/sofa-001');
  assert.ok(first.listingUrl.startsWith('https://item.rakuten.co.jp/sofashop/sofa-001/'));
  assert.equal(first.shop, 'sofashop');
  assert.equal(first.rankPosition, 1);
  assert.equal(first.title, '電動リクライニングソファ 2人掛け 本革 ブラウン');
  assert.equal(first.price, 49800);
  assert.equal(first.rating, null); // rating not in "レビュー評価" format
  assert.equal(first.reviewCount, 128);
  assert.equal(first.isSponsored, false);

  assert.equal(second.externalListingId, 'furniture-plus/rc-200');
  assert.equal(second.shop, 'furniture-plus');
  assert.equal(second.rankPosition, 3);
  assert.equal(second.title, 'リクライニングチェア オットマン付き 電動 布張り');
  assert.equal(second.price, 32500);
  assert.equal(second.reviewCount, 52);

  assert.equal(third.externalListingId, 'interior-mart/is-800');
  assert.equal(third.rankPosition, 4);
  assert.equal(third.price, 19800);
  assert.equal(third.reviewCount, 245);
});

test('parseRakutenResults skips sponsored items', () => {
  const items = parseRakutenResults(searchResultsFixture, 10);
  const sponsored = items.filter((i) => i.externalListingId === 'spamshop/spam-999');
  assert.equal(sponsored.length, 0, 'sponsored item should have been filtered out');
});

test('parseRakutenResults respects limit', () => {
  const items = parseRakutenResults(searchResultsFixture, 2);
  assert.equal(items.length, 2);
});

test('parseRakutenResults returns empty array for empty HTML', () => {
  const items = parseRakutenResults('<html></html>', 10);
  assert.equal(items.length, 0);
});

test('parseRakutenResults deduplicates by external ID', () => {
  const dupHtml = `
    <div class="dui-card searchresultitem"><a class="title-link" href="https://item.rakuten.co.jp/shop1/item1/">Title A</a></div>
    <div class="dui-card searchresultitem"><a class="title-link" href="https://item.rakuten.co.jp/shop1/item1/?variant=2">Title A</a></div>
    <div class="dui-card searchresultitem"><a class="title-link" href="https://item.rakuten.co.jp/shop1/item2/">Title B</a></div>
  `;
  const items = parseRakutenResults(dupHtml, 10);
  assert.equal(items.length, 2);
});

test('deriveTargetProfile extracts frequent Japanese title terms', () => {
  const titles = [
    '電動リクライニングソファ 2人掛け 本革 ブラウン',
    '電動リクライニングソファ 3人掛け ファブリック グレー',
    'リクライニングチェア 電動 オットマン付き 布張り',
    '電動ソファ コンパクト 一人暮らし おしゃれ 小型',
    'リクライニングソファ 電動 2人掛け 左右独立',
  ];

  const profile = deriveTargetProfile(titles);

  assert.ok(profile.titleTerms.length > 0, 'should extract title terms');
  assert.ok(
    profile.titleTerms.includes('電動') ||
      profile.titleTerms.includes('リクライニング'),
    'should include frequent terms like 電動 or リクライニング',
  );

  assert.equal(profile.descriptionTopics.length, 1);
  assert.equal(profile.descriptionTopics[0].name, 'unavailable_in_search_capture_v1');
  assert.deepEqual(profile.descriptionTopics[0].terms, []);
});

test('deriveTargetProfile filters single-character and punctuation words', () => {
  const titles = [
    'A B テスト',
    'C D テスト 商品',
  ];

  const profile = deriveTargetProfile(titles);

  assert.ok(profile.titleTerms.includes('テスト'), 'multi-char word should appear');
  const singleChar = profile.titleTerms.filter((t) => t.length < 2);
  assert.equal(singleChar.length, 0, 'single-char words should be filtered');
});

test('deriveTargetProfile records multi-size suitcase listing strategy', () => {
  const profile = deriveTargetProfile([
    'スーツケース Sサイズ Mサイズ Lサイズ TSAロック',
    'スーツケース SSサイズ Sサイズ Mサイズ Lサイズ',
    'スーツケース Sサイズ Mサイズ Lサイズ キャリーケース',
    'スーツケース Sサイズ キャリーケース',
    'スーツケース SSサイズ 小型',
  ]);
  assert.equal(profile.assortment.strategy, 'multi_size');
  assert.equal(profile.assortment.multiSizeListingCount, 3);
  assert.deepEqual(profile.assortment.observedSizes.sort(), ['L', 'M', 'S', 'SS']);
});

test('deriveTargetProfile requires at least 2 occurrences', () => {
  const titles = [
    '電動リクライニングソファ',
    '収納ケース 大容量',
  ];

  const profile = deriveTargetProfile(titles);

  for (const term of profile.titleTerms) {
    const count = titles.filter((t) => t.includes(term)).length;
    assert.ok(count >= 2, `term "${term}" appears ${count} times, expected >= 2`);
  }
});

test('computeContentHash is deterministic', () => {
  const a = computeContentHash({ foo: 'bar', baz: [1, 2, 3] });
  const b = computeContentHash({ foo: 'bar', baz: [1, 2, 3] });
  assert.equal(a, b);
  assert.equal(a.length, 64, 'SHA-256 hex digest is 64 chars');

  const different = computeContentHash({ foo: 'bar', baz: [1, 2, 4] });
  assert.notEqual(a, different);
});
