// Self-check logic gop don. Chay: node test-aggregate.mjs
// Payload theo DUNG hinh dang response that cua
// POST /affiliate_partner/202603/cap_order/search (da an danh creator_username).
import assert from 'node:assert/strict';
import { aggregate, money } from './src/sync.js';

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
assert.equal(a.gmv, 91992 + 100000 + 30000, 'GROSS gom ca don huy; dong lap khong cong doi');
assert.equal(a.refund_amount, 30000, 'don INELIGIBLE');
assert.equal(a.net_gmv, 191992);
assert.equal(a.items_sold, 3, '1 + 2, don huy khong tinh');
assert.equal(a.est_commission, 14719 + 16000, 'don huy khong tinh hoa hong');
assert.equal(a.commission_base, 91992 + 100000);
// AOV phai dung CUNG CO SO: gmv gom ca don huy nen mau so la TONG don (1 hop le + 1 huy).
assert.equal(a.aov, 110996, 'gmv / (orders + refund_orders), KHONG phai gmv/orders');
assert.notEqual(a.aov, a.gmv / a.orders, 'khong duoc chia cho rieng don hop le');
assert.equal(a.creators_active, 1);
assert.equal(a.refund_orders, 1, 'don INELIGIBLE duoc dem la don huy');

const b = byCreator.get('creator_b');
assert.equal(b.orders, 1, "fully_return='Yes' khong dem la don");
assert.equal(b.gmv, 20000 + 30000);
assert.equal(b.refund_amount, 20000);
assert.equal(b.items_sold, 3);
assert.equal(b.est_commission, 4800 + 200, 'cong ca estimated_bonus_commission');
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

console.log('aggregate OK');
