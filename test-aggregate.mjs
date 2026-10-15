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
assert.equal(a.aov, 221992, 'gmv / orders');
assert.equal(a.creators_active, 1);

const b = byCreator.get('creator_b');
assert.equal(b.orders, 1, "fully_return='Yes' khong dem la don");
assert.equal(b.gmv, 20000 + 30000);
assert.equal(b.refund_amount, 20000);
assert.equal(b.items_sold, 3);
assert.equal(b.est_commission, 4800 + 200, 'cong ca estimated_bonus_commission');
assert.equal(Number(b.refund_rate.toFixed(2)), 40);

// Creator khong co don hop le van duoc ghi nhan la da thay
const only = aggregate([
  row({ id: 'x1', creator_username: 'creator_c', settle_status: 'INELIGIBLE', price: M(1000), quantity: 1,
        estimated_commission_base: M(1000), estimated_standard_commission: M(160) }),
]).byCreator.get('creator_c');
assert.equal(only.creators_seen, 1);
assert.equal(only.creators_active, 0, 'thay nhung khong co don hop le');
assert.equal(only.aov, 0, 'khong chia cho 0');

// Tron currency thi tong tien vo nghia -> phai canh bao
const mixed = aggregate([
  row({ id: 'y1', creator_username: 'd', settle_status: 'PENDING', price: { amount: '10', currency: 'USD' },
        quantity: 1, estimated_commission_base: M(10), estimated_standard_commission: M(2) }),
]);
assert.match(mixed.warnings.join(' '), /tron nhieu currency/);

assert.equal(aggregate([]).byCreator.size, 0);
assert.equal(aggregate(undefined).byCreator.size, 0);

console.log('aggregate OK');
