// Self-check logic gop don. Chay: node test-aggregate.mjs
// Payload theo DUNG hinh dang response that cua
// POST /affiliate_partner/202603/cap_order/search (da an danh creator_username).
import assert from 'node:assert/strict';
import { aggregate, money, runSync, rowKey, MAX_SYNC_DAYS } from './src/sync.js';
import { ratios } from './src/metrics.js';

// --- money(): da xac nhan bang du lieu that la chuoi so thuan, khong ky hieu tien te
assert.equal(money({ amount: '91992', currency: 'VND' }).value, 91992);
assert.equal(money({ currency: 'VND' }).value, 0, 'actual_* thieu amount khi don chua settle');
assert.equal(money({ currency: 'VND' }).bad, 0, 'thieu amount KHONG phai loi parse');
assert.equal(money({ amount: 'Rp9.900', currency: 'IDR' }).value, 9900, 'phong thu: dau . la phan cach nghin');
assert.equal(money({ amount: '$9.90', currency: 'USD' }).value, 9.9);
assert.equal(money({ amount: 'khong-ro' }).bad, 1, 'rac thi phai bao, khong am tham tra 0');

// Mot dong SKU-order that co 48 truong; day giu lai nhung truong aggregate() thuc su doc.
const row = (o) => ({
  sku_id: '1729478689395213981', product_id: '172943531', product_name: 'san-pham',
  shop_name: 'Shop Test', content_type: 'LIVE', content_id: '749399057',
  commission_model: 'Fixed commission', standard_commission_rate: 1600,
  commission_bonus_rate: 0, shop_ads_commission_rate: 0, tap_bonus_commission_rate: 0,
  revenue_sharing_portion_rate: 1000,
  estimated_bonus_commission: { currency: 'VND' },        // vang amount -> 0, khong phai loi
  estimated_shop_ads_commission: { currency: 'VND' },
  estimated_tap_bonus_commission: { currency: 'VND' },
  actual_commission_base: { currency: 'VND' },            // chi co amount khi SETTLED/INELIGIBLE
  fully_return: 'No', is_carousel: false, last_update_time: 1792049799,
  ...o,
});

const M = (a) => ({ amount: String(a), currency: 'VND' });

const { byCreator, warnings } = aggregate([
  // creator A, don #1: 2 dong SKU chung 1 id -> van la 1 don
  row({ id: '586602167416358435', creator_username: 'creator_a', settle_status: 'PENDING',
        price: M(91992), quantity: 1,
        estimated_commission_base: M(91992), estimated_standard_commission: M(14719) }),
  row({ id: '586602167416358435', sku_id: 'sku-2', creator_username: 'creator_a', settle_status: 'PENDING',
        price: M(50000), quantity: 2,
        estimated_commission_base: M(100000), estimated_standard_commission: M(16000) }),
  // dong lap y nguyen cua trang truoc -> phai bo
  row({ id: '586602167416358435', creator_username: 'creator_a', settle_status: 'PENDING',
        price: M(91992), quantity: 1,
        estimated_commission_base: M(91992), estimated_standard_commission: M(14719) }),
  // creator A, don #2 bi huy
  row({ id: '586602167416358436', creator_username: 'creator_a', settle_status: 'INELIGIBLE',
        price: M(30000), quantity: 1,
        estimated_commission_base: M(30000), estimated_standard_commission: M(4800) }),
  // creator B, don hoan toan phan qua fully_return du settle_status van SETTLED
  row({ id: '586602167416358437', creator_username: 'creator_b', settle_status: 'SETTLED',
        fully_return: 'Yes', price: M(20000), quantity: 1,
        estimated_commission_base: M(20000), estimated_standard_commission: M(3200) }),
  // creator B, don binh thuong co them bonus
  row({ id: '586602167416358438', creator_username: 'creator_b', settle_status: 'SETTLED',
        price: M(10000), quantity: 3,
        estimated_commission_base: M(30000), estimated_standard_commission: M(4800),
        estimated_bonus_commission: M(200) }),
]);

assert.deepEqual(warnings, [], 'cung VND, moi amount doc duoc');
assert.deepEqual([...byCreator.keys()].sort(), ['creator_a', 'creator_b']);

const a = byCreator.get('creator_a');
assert.equal(a.orders, 1, '2 dong chung id = 1 don; don INELIGIBLE khong dem; dong lap bi bo');
assert.equal(a.orders_all, 2, 'orders_all dem ca don hop le va don INELIGIBLE');
assert.equal(a.gmv, 91992 + 100000 + 30000, 'GROSS gom ca don huy; dong lap khong cong doi');
assert.equal(a.refund_amount, 30000, 'don INELIGIBLE');
assert.equal(a.net_gmv, 191992);
assert.equal(a.items_sold, 4, 'items_sold gross gom ca quantity bi huy');
assert.equal(a.items_sold_net, 3, 'items_sold_net loai quantity bi huy');
assert.equal(a.refunded_items, 1, 'refunded_items dem quantity bi huy');
assert.equal(a.est_commission, 14719 + 16000 + 4800, 'est_commission gross gom ca estimated cua don huy');
assert.equal(a.est_commission_net, 14719 + 16000, 'est_commission_net loai don huy');
assert.equal(a.commission_base, 91992 + 100000 + 30000, 'commission_base gross gom ca don huy');
assert.equal(a.commission_base_net, 91992 + 100000);
// AOV phai dung CUNG CO SO: gmv gom ca don huy nen mau so la TONG don (1 hop le + 1 huy).
assert.equal(a.aov, 110996, 'gmv / (orders + refund_orders), KHONG phai gmv/orders');
assert.notEqual(a.aov, a.gmv / a.orders, 'khong duoc chia cho rieng don hop le');
assert.equal(a.creators_active, 1);
assert.equal(a.refund_orders, 1, 'don INELIGIBLE duoc dem la don huy');

const b = byCreator.get('creator_b');
assert.equal(b.orders, 1, "fully_return='Yes' khong dem la don");
assert.equal(b.orders_all, 2, "orders_all dem ca don fully_return");
assert.equal(b.gmv, 20000 + 30000);
assert.equal(b.refund_amount, 20000);
assert.equal(b.items_sold, 4, 'items_sold gross gom ca dong fully_return');
assert.equal(b.items_sold_net, 3);
assert.equal(b.refunded_items, 1);
assert.equal(b.est_commission, 3200 + 4800 + 200, 'gross commission gom ca dong fully_return');
assert.equal(b.est_commission_net, 4800 + 200, 'net commission loai dong fully_return');
assert.equal(b.commission_base, 20000 + 30000);
assert.equal(b.commission_base_net, 30000);
assert.equal(Number(b.refund_rate.toFixed(2)), 40);
assert.equal(b.refund_orders, 0, "fully_return='Yes' tren don SETTLED KHONG phai don huy ca don");

// Creator khong co don hop le van duoc ghi nhan la da thay
const only = aggregate([
  row({ id: 'x1', creator_username: 'creator_c', settle_status: 'INELIGIBLE', price: M(1000), quantity: 1,
        estimated_commission_base: M(1000), estimated_standard_commission: M(160) }),
]).byCreator.get('creator_c');
assert.equal(only.creators_seen, 1);
assert.equal(only.creators_active, 0, 'thay nhung khong co don hop le');
// Don bi huy VAN la mot don da dat, co gia tri -> AOV = 1000, khong phai 0.
// Trang thai "toan don huy" the hien o orders = 0 va refund_rate = 100%, khong phai o AOV.
assert.equal(only.aov, 1000, 'AOV tinh tren TONG don, don huy van co gia tri');
assert.equal(only.orders, 0, 'khong co don hop le nao');
assert.equal(only.orders_all, 1);
assert.equal(only.est_commission, 160);
assert.equal(only.est_commission_net, 0);
assert.equal(only.refund_orders, 1, 'chi co don huy van dem duoc');

// Tron currency thi tong tien vo nghia -> phai canh bao
const mixed = aggregate([
  row({ id: 'y1', creator_username: 'd', settle_status: 'PENDING', price: { amount: '10', currency: 'USD' },
        quantity: 1, estimated_commission_base: M(10), estimated_standard_commission: M(2) }),
]);
assert.match(mixed.warnings.join(' '), /tron nhieu currency/);

assert.equal(aggregate([]).byCreator.size, 0);
assert.equal(aggregate(undefined).byCreator.size, 0);

// --- Cac chieu san pham / shop / video / live (content_type = LIVE | VIDEO | SHOP).
// Da do tren du lieu that: 100% dong co product_id, product_name, shop_name, content_type.
const dim = aggregate([
  // 1 don, 2 dong SKU: 2 san pham khac nhau, cung 1 video
  row({ id: 'd1', creator_username: 'e', settle_status: 'PENDING', content_type: 'VIDEO', content_id: 'v1',
        product_id: 'p1', shop_name: 'Shop 1', price: M(100), quantity: 1,
        estimated_commission_base: M(100), estimated_standard_commission: M(10) }),
  row({ id: 'd1', sku_id: 's2', creator_username: 'e', settle_status: 'PENDING', content_type: 'VIDEO', content_id: 'v1',
        product_id: 'p2', shop_name: 'Shop 1', price: M(100), quantity: 1,
        estimated_commission_base: M(100), estimated_standard_commission: M(10) }),
  // don khac, cung san pham p1 nhung tu 1 buoi live va shop khac
  row({ id: 'd2', creator_username: 'e', settle_status: 'PENDING', content_type: 'LIVE', content_id: 'l1',
        product_id: 'p1', shop_name: 'Shop 2', price: M(100), quantity: 1,
        estimated_commission_base: M(100), estimated_standard_commission: M(10) }),
  // content_type SHOP: khong phai video cung khong phai live
  row({ id: 'd3', creator_username: 'e', settle_status: 'PENDING', content_type: 'SHOP', content_id: 'c1',
        product_id: 'p3', shop_name: 'Shop 2', price: M(100), quantity: 1,
        estimated_commission_base: M(100), estimated_standard_commission: M(10) }),
  // don bi huy: KHONG duoc tinh vao bat ky chieu nao (cung co so voi `orders`)
  row({ id: 'd4', creator_username: 'e', settle_status: 'INELIGIBLE', content_type: 'VIDEO', content_id: 'v-huy',
        product_id: 'p-huy', shop_name: 'Shop huy', price: M(100), quantity: 1,
        estimated_commission_base: M(100), estimated_standard_commission: M(10) }),
]).byCreator.get('e');

assert.equal(dim.products_sold, 3, 'p1 lap lai o 2 don -> dem 1 lan; p-huy bi loai');
assert.equal(dim.shops_sold, 2, 'Shop 1 + Shop 2; Shop huy bi loai');
assert.equal(dim.videos_with_orders, 1, 'v1 xuat hien o 2 dong SKU -> 1 video; v-huy bi loai');
assert.equal(dim.lives_with_orders, 1);
assert.equal(dim.orders, 3, 'd1,d2,d3 hop le; d4 huy');
assert.equal(dim.orders_all, 4, 'orders_all gom ca d4');
assert.equal(dim.items_sold, 5, 'items_sold gross gom ca d4');
assert.equal(dim.items_sold_net, 4, 'items_sold_net loai d4');
assert.equal(dim.refunded_items, 1);

// --- ratios(): MOT ham duy nhat cho ca 4 cho hien thi -----------------------
// Truoc day cong thuc duoc viet lai o aggregate, /api/summary, /api/daily va
// /api/creators; /api/summary da lech va khong co test nao bat duoc.
// 2 don hop le + 1 don INELIGIBLE, gmv 300k, base 160k, hoa hong 24k.
const t = { gmv: 300000, orders: 2, refund_orders: 1,
            est_commission: 24000, commission_base: 160000, refund_amount: 100000 };
const r = ratios(t);

// Mau so cua AOV la TONG don (hop le + huy), KHONG phai rieng don hop le.
assert.equal(r.aov, 100000, 'AOV = gmv / (orders + refund_orders)');
assert.notEqual(r.aov, t.gmv / t.orders, 'gmv/orders thoi AOV len 50% -- day la bug cu');

// Mau so cua %hoa hong la commission_base, KHONG phai gmv.
assert.equal(r.commission_rate, 15, '%HH = est_commission / commission_base * 100');
assert.notEqual(r.commission_rate, (t.est_commission / t.gmv) * 100,
  'chia cho gmv bao %HH chi con 53% gia tri that -- day la bug cu');

assert.equal(r.refund_rate, 100000 / 300000 * 100);

// Chia 0 phai ra 0, khong phai NaN/Infinity: ngay chua co don nao van phai render duoc.
const zero = ratios({});
assert.deepEqual(zero, { aov: 0, commission_rate: 0, refund_rate: 0 });
for (const [k, v] of Object.entries(zero)) assert.ok(Number.isFinite(v), `${k} phai huu han`);

// pg tra numeric duoi dang CHUOI -> ratios() phai chiu duoc chuoi, neu khong
// /api/summary va /api/creators cong chuoi va ra ket qua vo nghia.
assert.deepEqual(ratios({ gmv: '300000', orders: '2', refund_orders: '1',
                          est_commission: '24000', commission_base: '160000',
                          refund_amount: '100000' }), r, 'phai xu ly numeric dang chuoi');

// Va aggregate() phai dung DUNG ham do, khong phai mot ban copy.
assert.equal(dim.aov, ratios(dim).aov, 'aggregate phai lay aov tu ratios()');
assert.equal(dim.commission_rate, ratios(dim).commission_rate);
assert.equal(dim.refund_rate, ratios(dim).refund_rate);

// --- §6.4: don co ca dong INELIGIBLE va dong hop le phai duoc BAO -----------
// Mau so AOV = orders + refund_orders, dung VI settle_status la trang thai ca don nen
// hai tap roi nhau. Neu du lieu pha gia dinh do thi AOV dem doi don -- khong tu suy dien
// lai so lieu, nhung phai noi ra, neu khong no la sai so am tham khong ai tim duoc.
const split = aggregate([
  row({ id: 'z1', sku_id: 'sa', creator_username: 'e', settle_status: 'SETTLED',
        price: M(1000), quantity: 1,
        estimated_commission_base: M(1000), estimated_standard_commission: M(100) }),
  row({ id: 'z1', sku_id: 'sb', creator_username: 'e', settle_status: 'INELIGIBLE',
        price: M(1000), quantity: 1 }),
]);
assert.match(split.warnings.join(' '), /settle_status khong con la trang thai cua ca don/,
  'don nam ca hai ben phai duoc bao');
const e = split.byCreator.get('e');
assert.equal(e.orders, 1);
assert.equal(e.refund_orders, 1, 'cung mot order_id dem o ca hai ben -> day la cai duoc bao');
assert.equal(e.orders_all, 1, 'orders_all khong dem doi order co nhieu dong status');
assert.equal(e.aov, 2000, 'AOV dung orders_all nen khong dem doi order mixed status');

const lowerCaseReturn = aggregate([
  row({ id: 'lc1', creator_username: 'lower', settle_status: 'SETTLED', fully_return: 'yes',
        price: M(1000), quantity: 1 }),
]).byCreator.get('lower');
assert.equal(lowerCaseReturn.orders, 0, 'fully_return khong phu thuoc chu hoa-thuong');
assert.equal(lowerCaseReturn.refunded_items, 1);

// Du lieu binh thuong (settle_status dung la cua ca don) thi KHONG duoc bao gi.
assert.equal(aggregate([
  row({ id: 'z2', sku_id: 'sa', creator_username: 'f', settle_status: 'SETTLED',
        price: M(1000), quantity: 1,
        estimated_commission_base: M(1000), estimated_standard_commission: M(100) }),
  row({ id: 'z3', sku_id: 'sa', creator_username: 'f', settle_status: 'INELIGIBLE',
        price: M(1000), quantity: 1 }),
]).warnings.filter(w => /settle_status/.test(w)).length, 0, 'du lieu dung thi khong duoc bao');

// --- §6.3: khoa dedup phai GIONG HET giua aggregate() va writeRaw() ---------
// Bug cu KHONG phai aggregate dedup sai mot minh (no van gom 'undefined|undefined' lai
// voi nhau): bug la HAI BEN ghep khoa khac nhau -- aggregate dung `${r.sku_id}` (ra chuoi
// 'undefined') con writeRaw dung `?? ''`. Gio ca hai goi cung rowKey(), nen dieu phai
// kiem la chinh hop dong cua ham do: truong vang mat thanh '' chu khong phai 'undefined'.
// Day cung la quy uoc cua bang (sku_orders.content_id ... not null default '').
assert.equal(rowKey({ id: 'a' }), 'a||', "truong vang mat phai thanh '' nhu trong bang");
assert.equal(rowKey({ id: 'a', sku_id: 's' }), 'a|s|');
assert.equal(rowKey({ id: 'a', sku_id: 's', content_id: 'c' }), 'a|s|c');
assert.ok(!rowKey({ id: 'a' }).includes('undefined'),
  "khoa KHONG duoc chua 'undefined' -- do la cho hai ben tung lech nhau");
// null va undefined phai cho cung mot khoa, khong duoc tach thanh hai dong.
assert.equal(rowKey({ id: 'a', sku_id: null }), rowKey({ id: 'a', sku_id: undefined }));
const noSku = aggregate([
  { id: 'n1', creator_username: 'g', settle_status: 'SETTLED', quantity: 1,
    price: M(500), estimated_commission_base: M(500), estimated_standard_commission: M(50) },
  { id: 'n1', creator_username: 'g', settle_status: 'SETTLED', quantity: 1,
    price: M(500), estimated_commission_base: M(500), estimated_standard_commission: M(50) },
]).byCreator.get('g');
assert.equal(noSku.gmv, 500, 'hai dong y het (deu thieu sku_id) phai duoc coi la MOT dong');
assert.equal(noSku.items_sold, 1);

// --- §6.6: `days` den tu body HTTP -> phai bi chan ------------------------
assert.ok(Number.isInteger(MAX_SYNC_DAYS) && MAX_SYNC_DAYS > 0 && MAX_SYNC_DAYS <= 1000,
  'tran so ngay phai la mot so nguyen hop ly');
// Ba gia tri duoi day truoc kia deu chay vao vong lap: 0/-1 chay 0 vong (im lang khong
// lam gi), 'abc' thanh NaN. Gio phai tu choi TRUOC khi mo run moi trong sync_runs.
for (const bad of [0, -1, 'abc', NaN, Infinity, null]) {
  await assert.rejects(() => runSync({ days: bad }), /days khong hop le/,
    `days=${String(bad)} phai bi tu choi`);
}

console.log('aggregate OK');
