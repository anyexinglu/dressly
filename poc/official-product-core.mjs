import { createHash } from 'node:crypto';

export function md5(value) {
  return createHash('md5').update(value).digest('hex').toUpperCase();
}

export function sortedSignature(secret, params) {
  const body = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}${value}`)
    .join('');
  return md5(`${secret}${body}${secret}`);
}

export function moneyFromFen(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? (number / 100).toFixed(2) : null;
}

export function stringValue(value) {
  return value === undefined || value === null ? null : String(value);
}

export function normalizePdd(item) {
  return {
    id: stringValue(item.goods_id), title: item.goods_name ?? null,
    imageUrl: item.goods_thumbnail_url ?? item.goods_image_url ?? null,
    listPrice: moneyFromFen(item.min_group_price), promotionPrice: moneyFromFen(item.min_group_price),
    couponValue: moneyFromFen(item.coupon_discount),
    destinationUrl: item.goods_sign ? `pdd-goods-sign:${item.goods_sign}` : null,
  };
}

export function normalizeJd(item) {
  const price = item.priceInfo?.price ?? item.price ?? item.lowestPrice;
  return {
    id: stringValue(item.skuId ?? item.sku_id), title: item.skuName ?? item.title ?? null,
    imageUrl: item.imageInfo?.imageList?.[0]?.url ?? item.imgUrl ?? item.imageUrl ?? null,
    listPrice: stringValue(price), promotionPrice: stringValue(item.priceInfo?.lowestCouponPrice ?? item.lowestPrice ?? price),
    couponValue: stringValue(item.couponInfo?.couponList?.[0]?.discount),
    destinationUrl: item.materialUrl ?? item.wlPrice ?? item.link ?? null,
  };
}

export function normalizeTaobao(item) {
  return {
    id: stringValue(item.item_id ?? item.num_iid), title: item.title ?? null,
    imageUrl: item.pict_url ?? item.pic_url ?? null,
    listPrice: stringValue(item.zk_final_price ?? item.reserve_price),
    promotionPrice: stringValue(item.final_promotion_price ?? item.zk_final_price),
    couponValue: stringValue(item.coupon_amount),
    destinationUrl: item.coupon_click_url ?? item.item_url ?? null,
  };
}

export function validateProducts(products) {
  return products.map((item) => ({ ...item, valid: Boolean(item.id && item.title && item.imageUrl && item.promotionPrice) }));
}
