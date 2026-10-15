// NGUỒN: tài liệu chính thức TikTok Shop Partner Center, kéo qua endpoint `api_meta`
// ngày 2026-10-15. Trường `en` là NGUYÊN VĂN, không sửa một chữ.
// Trường `vi` là BẢN DỊCH của dashboard này — thứ duy nhất ở đây không phải của TikTok.
//
//   docs: /docv2/page/search-cap-affiliate-orders-202603
//         /docv2/page/get-authorized-category-assets-202405

export const API = {
  cap_order_search: {
    method: 'POST',
    path: '/affiliate_partner/202603/cap_order/search',
    title: 'Search CAP Affiliate Orders',
    docUrl: 'https://partner.tiktokshop.com/docv2/page/search-cap-affiliate-orders-202603',
    en: 'Search affiliate orders for an MCN (Creator Agency Partner) within the specified or default creation-time range. When multiple request-body filters are provided, `order_id`, `product_id`, `settle_status`, and the creation-time range are combined using AND semantics, so an order must match every supplied filter.',
    vi: 'Tìm các đơn affiliate của một MCN (Creator Agency Partner) trong khoảng thời gian tạo đơn được chỉ định hoặc mặc định. Khi truyền nhiều bộ lọc trong request body, các điều kiện `order_id`, `product_id`, `settle_status` và khoảng thời gian tạo được kết hợp theo nghĩa AND — đơn phải khớp mọi điều kiện đã truyền.',
    scope: {
      key: 'partner.cap_orders.read',
      name: 'Read CAP earnings order',
      packageId: 2849348,
      en: "The application will be able to access a CAP earnings data, including view CAP managed all creator's order list and related earings details.",
      vi: 'Ứng dụng sẽ truy cập được dữ liệu thu nhập CAP, bao gồm xem danh sách đơn của tất cả creator do CAP quản lý và chi tiết thu nhập liên quan.',
    },
  },
  category_assets: {
    method: 'GET',
    path: '/authorization/202405/category_assets',
    title: 'Get Authorized Category Assets',
    docUrl: 'https://partner.tiktokshop.com/docv2/page/get-authorized-category-assets-202405',
    en: 'Retrieves the list of business category assets authorized by a partner for an app.\nPartner authorization is required before an app can access the data of a partner, and this access is granted based on business categories. Use this API to check which business category assets are currently authorized for an app and obtain the corresponding category asset cipher for use as an input parameter in affiliate partner related APIs.\nTarget partner: All',
    vi: 'Lấy danh sách business category asset mà một partner đã uỷ quyền cho một app.\nApp phải được partner uỷ quyền trước khi truy cập dữ liệu của partner đó, và quyền truy cập được cấp theo business category. Dùng API này để kiểm tra app đang được uỷ quyền những category asset nào và lấy cipher tương ứng để truyền vào các API thuộc nhóm affiliate partner.\nĐối tượng áp dụng: tất cả partner.',
    scope: { key: 'partner.authorization.info' },
  },
};

// Tham số request. `en` nguyên văn, `vi` là bản dịch.
export const REQUEST = {
  page_size: {
    en: 'The default is 20, it must be positive integer, the range is 1-100',
    vi: 'Mặc định là 20, phải là số nguyên dương, nằm trong khoảng 1–100.',
  },
  page_token: {
    en: 'Pagination token returned in `next_page_token` from the previous response. The token contains only the search-after sort position; it does not preserve the search filters or `page_size`. Omit this parameter for the first page. For each subsequent page, pass the returned token, provide a valid `page_size`, and resend the same partner authorization context and request-body filters used for the first page. The `page_size` value can be set independently for each page. For stable pagination, explicitly provide the same fixed `create_time_ge` and `create_time_lt` values on every request instead of relying on the rolling default time range.',
    vi: 'Token phân trang được trả về ở `next_page_token` của response trước. Token chỉ chứa vị trí sắp xếp search-after; nó KHÔNG giữ lại bộ lọc tìm kiếm hay `page_size`. Bỏ qua tham số này ở trang đầu tiên. Với mỗi trang kế tiếp, truyền token nhận được, cung cấp `page_size` hợp lệ, và gửi lại đúng ngữ cảnh uỷ quyền partner cùng các bộ lọc trong request body đã dùng ở trang đầu. Giá trị `page_size` có thể đặt riêng cho từng trang. Để phân trang ổn định, hãy truyền tường minh cùng một giá trị `create_time_ge` và `create_time_lt` cố định ở mọi request, thay vì dựa vào khoảng thời gian mặc định trượt theo thời điểm gọi.',
  },
  category_asset_cipher: {
    en: 'The partner identifier used in API requests. Retrieve this value by using the Get Authorized Category Assets API.',
    vi: 'Định danh partner dùng trong các request API. Lấy giá trị này bằng API Get Authorized Category Assets.',
  },
  create_time_ge: {
    en: 'Filter orders created at or after this time. Unix timestamp in seconds. `create_time_ge` and `create_time_lt` must be provided together. An explicitly supplied range can span at most 92 days. If neither field is provided, the API searches from three calendar months before the request time through the request time.',
    vi: 'Lọc các đơn được tạo từ thời điểm này trở đi. Unix timestamp tính bằng giây. `create_time_ge` và `create_time_lt` phải được truyền cùng nhau. Khoảng thời gian truyền tường minh tối đa 92 ngày. Nếu không truyền cả hai, API sẽ tìm từ ba tháng dương lịch trước thời điểm gọi cho tới thời điểm gọi.',
  },
  create_time_lt: {
    en: 'Filter orders created before this time. Unix timestamp in seconds. `create_time_ge` and `create_time_lt` must be provided together.',
    vi: 'Lọc các đơn được tạo trước thời điểm này. Unix timestamp tính bằng giây. `create_time_ge` và `create_time_lt` phải được truyền cùng nhau.',
  },
};

// Trường trong response. Khoá = đường dẫn trường trong `data.sku_orders[]`.
export const FIELDS = {
  sku_orders: {
    type: '[]object',
    en: 'SKU orders returned for the current page.\n\nFor monetary fields whose names start with `actual_`, the nested `amount` can be present only when `settle_status` is `SETTLED` or `INELIGIBLE`. For all other statuses, the `amount` property is omitted. Even for `SETTLED` or `INELIGIBLE` orders, an individual `actual_*` field can still omit `amount`.',
    vi: 'Các SKU-order trả về trong trang hiện tại.\n\nVới các trường tiền có tên bắt đầu bằng `actual_`, trường con `amount` chỉ xuất hiện khi `settle_status` là `SETTLED` hoặc `INELIGIBLE`. Với mọi trạng thái khác, thuộc tính `amount` bị bỏ qua. Ngay cả với đơn `SETTLED` hoặc `INELIGIBLE`, từng trường `actual_*` riêng lẻ vẫn có thể thiếu `amount`.',
  },
  id: {
    type: 'string',
    en: 'Transaction main order ID',
    vi: 'Mã đơn hàng chính của giao dịch.',
  },
  create_time: {
    type: 'int',
    en: 'Unix timestamp in seconds when the order was created (UTC).',
    vi: 'Unix timestamp (giây) thời điểm đơn được tạo, theo giờ UTC.',
  },
  creator_username: {
    type: 'string',
    en: 'Creator username',
    vi: 'Username của creator.',
  },
  settle_status: {
    type: 'string',
    en: 'Settlement Status of the order.\nPossible values:\n1. "CUSTOMER UNPAID",  customer hasn\'t paid for the orders.\n2. "PENDING", customers can still return or get a refund for this order. The earnings shown are estimates and waiting for settlement.\n3. "SETTLED", your earnings have already settled to your account\n4. "INELIGIBLE", The order has been returned/refunded/canceled by the buyer, and no commission will be settled.\n5. "FROZEN", Possible fraud has been detected regarding the order. The commission will be unfrozen after the fraud is resolved.',
    vi: 'Trạng thái quyết toán của đơn.\nCác giá trị có thể có:\n1. "CUSTOMER UNPAID" — khách chưa thanh toán đơn.\n2. "PENDING" — khách vẫn có thể trả hàng hoặc đòi hoàn tiền. Số thu nhập hiển thị là ước tính và đang chờ quyết toán.\n3. "SETTLED" — thu nhập đã được quyết toán vào tài khoản của bạn.\n4. "INELIGIBLE" — đơn đã bị người mua trả/hoàn/huỷ, sẽ không có hoa hồng nào được quyết toán.\n5. "FROZEN" — phát hiện khả năng gian lận với đơn này. Hoa hồng sẽ được gỡ đóng băng sau khi xử lý xong gian lận.',
  },
  price: {
    type: 'object',
    en: 'The SKU selling price information',
    vi: 'Thông tin giá bán của SKU.',
  },
  'price.amount': {
    type: 'string',
    en: 'SKU sale price amount without a currency symbol. Use the sibling `currency` field to identify the currency.',
    vi: 'Số tiền giá bán SKU, không kèm ký hiệu tiền tệ. Dùng trường `currency` nằm cùng cấp để xác định loại tiền.',
  },
  quantity: {
    type: 'int',
    en: 'Number of SKU items in the order, including refunded items.',
    vi: 'Số lượng sản phẩm SKU trong đơn, TÍNH CẢ phần đã hoàn.',
  },
  estimated_commission_base: {
    type: 'object',
    en: 'The estimated commission base is the product sale price multiplied by the number of products sold when the order is created.',
    vi: 'Gốc tính hoa hồng ước tính là giá bán sản phẩm nhân với số lượng sản phẩm bán ra tại thời điểm đơn được tạo.',
  },
  estimated_standard_commission: {
    type: 'object',
    en: 'Estimated standard commission on sales that a creator will obtain.',
    vi: 'Hoa hồng tiêu chuẩn ước tính trên doanh số mà creator sẽ nhận được.',
  },
  estimated_bonus_commission: {
    type: 'object',
    en: 'Estimated commission TTS pays well-performed creators',
    vi: 'Hoa hồng thưởng ước tính mà TikTok Shop trả cho các creator có thành tích tốt.',
  },
  estimated_shop_ads_commission: {
    type: 'object',
    en: 'Estimated commission on sales that a creator will receive from seller/advertisers purchasing a specific creative',
    vi: 'Hoa hồng ước tính trên doanh số mà creator nhận được khi seller/nhà quảng cáo mua một creative cụ thể.',
  },
  estimated_tap_bonus_commission: {
    type: 'object',
    en: 'Estimated commission bonus which TAP provided to creator',
    vi: 'Hoa hồng thưởng ước tính do TAP (TikTok Affiliate Partner) cấp cho creator.',
  },
  actual_commission_base: {
    type: 'object',
    en: 'The actual commission base is the product sale price multiplied by the number of products sold, excluding returned and refunded orders.',
    vi: 'Gốc tính hoa hồng thực tế là giá bán sản phẩm nhân với số lượng sản phẩm bán ra, KHÔNG tính các đơn đã trả và đã hoàn.',
  },
  fully_return: {
    type: 'string',
    en: 'Whether this SKU order was fully returned or refunded.\nPossible values:\n- `Yes`: this SKU order was fully returned or refunded, and no commission is paid.\n- `No`: this SKU order was not fully returned or refunded.',
    vi: 'SKU-order này có bị trả hoặc hoàn TOÀN BỘ hay không.\nCác giá trị có thể có:\n- `Yes`: SKU-order này đã bị trả hoặc hoàn toàn bộ, không có hoa hồng nào được trả.\n- `No`: SKU-order này không bị trả hoặc hoàn toàn bộ.',
  },
  sku_id: {
    type: "string",
    en: "The SKU identifier.",
    vi: "Mã định danh SKU (phiên bản cụ thể của sản phẩm: màu, size...).",
  },
  product_id: {
    type: "string",
    en: "Unique identifier for Product",
    vi: "Mã định danh duy nhất của sản phẩm.",
  },
  product_name: {
    type: "string",
    en: "The product name.",
    vi: "Tên sản phẩm.",
  },
  shop_name: {
    type: "string",
    en: "Shop / Seller name",
    vi: "Tên shop bán sản phẩm. Lưu ý: cap_order KHÔNG trả về shop_id, chỉ có tên.",
  },
  content_type: {
    type: "string",
    en: "The content format of the creator content through which the order was created.\nPossible values:\n- SHOP\n- VIDEO\n- LIVE\n- PRE_LIVE\n- PROMOTION_PAGE\n- LINKSHARE",
    vi: "Định dạng nội dung của creator mà đơn được tạo ra từ đó.\nCác giá trị có thể có:\n- SHOP\n- VIDEO\n- LIVE\n- PRE_LIVE\n- PROMOTION_PAGE\n- LINKSHARE",
  },
  content_id: {
    type: "string",
    en: "Unique identifier for content",
    vi: "Mã định danh của nội dung (video hoặc phiên live) sinh ra đơn.",
  },
  standard_commission_rate: {
    type: "int",
    en: "Seller-to-creator standard commission rate. Returned as an integer in hundredths of a percent without a percent sign; for example, 3000 represents 30%.",
    vi: "Tỷ lệ hoa hồng tiêu chuẩn, tính theo điểm cơ bản: 1200 = 12,00%.",
  },
  commission_model: {
    type: "string",
    en: "Commission calculation model.\nPossible values:\n- `Fixed commission`\n- `Tiered commission`",
    vi: "Mô hình hoa hồng áp dụng cho đơn.",
  },
  target_collaboration_id: {
    type: "string",
    en: "The target collaboration identifier associated with the order.",
    vi: "Mã chiến dịch hợp tác chỉ định (target collaboration) gắn với đơn.",
  },
  open_collaboration_id: {
    type: "string",
    en: "The open collaboration identifier associated with the order.",
    vi: "Mã chiến dịch hợp tác mở (open collaboration) gắn với đơn.",
  },
  delivery_time: {
    type: "int",
    en: "Unix timestamp in seconds when the order was delivered (UTC). This field is omitted when no delivery timestamp is available.",
    vi: "Unix timestamp (giây) thời điểm đơn được giao.",
  },
  next_page_token: {
    type: 'string',
    en: 'Pagination token for the next page. The token contains only the search-after sort position; it does not preserve the search filters or `page_size`. If this field is returned, pass it as `page_token` in the next request, provide a valid `page_size`, and resend the same partner authorization context and request-body filters used for the first page. The `page_size` value can be set independently for each page. For stable pagination, explicitly provide the same fixed `create_time_ge` and `create_time_lt` values on every request instead of relying on the rolling default time range. Stop paginating when this field is omitted. The field is omitted when the returned page contains fewer records than `page_size`.',
    vi: 'Token phân trang cho trang kế tiếp. Token chỉ chứa vị trí sắp xếp search-after; nó không giữ lại bộ lọc tìm kiếm hay `page_size`. Nếu trường này được trả về, hãy truyền nó làm `page_token` ở request kế tiếp, cung cấp `page_size` hợp lệ và gửi lại đúng ngữ cảnh uỷ quyền partner cùng các bộ lọc trong request body đã dùng ở trang đầu. Giá trị `page_size` có thể đặt riêng cho từng trang. Để phân trang ổn định, hãy truyền tường minh cùng một giá trị `create_time_ge` và `create_time_lt` cố định ở mọi request, thay vì dựa vào khoảng thời gian mặc định trượt theo thời điểm gọi. Dừng phân trang khi trường này không còn. Trường này bị bỏ qua khi trang trả về có ít bản ghi hơn `page_size`.',
  },
  total_count: {
    type: 'int',
    en: 'Total number of SKU orders matching the current search criteria across all pages.',
    vi: 'Tổng số SKU-order khớp với điều kiện tìm kiếm hiện tại, tính trên tất cả các trang.',
  },
};

// Trường của Get Authorized Category Assets.
export const CATEGORY_ASSET_FIELDS = {
  category_assets: {
    en: 'The list of business category assets that a partner has authorized for the app.',
    vi: 'Danh sách business category asset mà partner đã uỷ quyền cho app.',
  },
  cipher: {
    en: 'The encrypted category asset cipher for this authorized business category and target market. Use it as an input parameter in affiliate partner related APIs; you do not need to decrypt it.',
    vi: 'Chuỗi cipher đã mã hoá của category asset ứng với business category và target market được uỷ quyền. Dùng trực tiếp làm tham số đầu vào cho các API thuộc nhóm affiliate partner; không cần giải mã.',
  },
  target_market: {
    en: 'The target market associated with this authorized business category and its category asset cipher.',
    vi: 'Thị trường mục tiêu gắn với business category được uỷ quyền này và cipher tương ứng.',
  },
  'category.id': {
    en: 'The ID of the business category. Use this field to verify if the partner has authorized the correct category. Otherwise, request re-authorization from the partner.',
    vi: 'ID của business category. Dùng trường này để kiểm tra partner đã uỷ quyền đúng category hay chưa. Nếu sai, hãy yêu cầu partner uỷ quyền lại.',
  },
  'category.name': {
    en: 'The name of the business category. This name may change.',
    vi: 'Tên của business category. Tên này CÓ THỂ THAY ĐỔI.',
  },
};

// --- Affiliate CREATOR API: cần token của CHÍNH creator, token partner bị từ chối. ---
// `en` cũng NGUYÊN VĂN từ api_meta live (sinh bằng script, không gõ tay); `vi` là bản dịch.
// Khoá trường = đường dẫn ĐẦY ĐỦ trong `data` (vd `products.status.is_hidden`), vì trong
// cùng một doc có hàng loạt trường trùng tên lá (`id`, `status`, `rate`, `currency`).
// Tiền tố `q:` = query param, `b:` = body param.
export const CREATOR_API = {
  creator_profile: {
    method: "GET",
    path: "/affiliate_creator/202508/profiles",
    title: "Get Creator Profile",
    docId: "get-creator-profile-202508",
    docUrl: "https://partner.tiktokshop.com/docv2/page/get-creator-profile-202508",
    en: "Retrieves profile information for the creator associated with the access token. The creator must have a configured sales region; otherwise, the request fails with a precondition error.",
    vi: "Lấy thông tin profile của chính creator đã uỷ quyền (ứng với access token). Creator BẮT BUỘC phải có sales region đã cấu hình, nếu không request sẽ thất bại với lỗi precondition.",
    scope: { key: "creator.affiliate.info", name: "Affiliate Information", packageId: 434372,
      en: "The application will be able to access your TikTok Shop Affiliate information, including creator profile, live room metrics, and products added/sold.",
      vi: "Ứng dụng sẽ truy cập được thông tin TikTok Shop Affiliate của bạn, gồm profile creator, số liệu phòng live, và các sản phẩm đã thêm/đã bán." },
  },
  sample_applications: {
    method: "POST",
    path: "/affiliate_creator/202412/sample_applications/search",
    title: "Search Creator Sample Applications",
    docId: "search-creator-sample-applications-202412",
    docUrl: "https://partner.tiktokshop.com/docv2/page/search-creator-sample-applications-202412",
    en: "Search sample applications for the authenticated creator.",
    vi: "Tìm các yêu cầu hàng mẫu của chính creator đã uỷ quyền.",
    scope: { key: "creator.affiliate_collaboration.read", name: "Read Creator Affiliate Collaborations", packageId: 1021508,
      en: "The application will be able to get details regarding your collaborations, including searching collaborations, tracking collaboration performance, receiving collaboration detaiIs and updates, and querying sample applications and related fulfillment details.",
      vi: "Ứng dụng sẽ lấy được chi tiết về các chiến dịch hợp tác của bạn, gồm tìm kiếm hợp tác, theo dõi hiệu quả hợp tác, nhận chi tiết và cập nhật hợp tác, và truy vấn yêu cầu hàng mẫu cùng chi tiết thực hiện liên quan." },
  },
  showcase_products: {
    method: "GET",
    path: "/affiliate_creator/202405/showcases/products",
    title: "Get Showcase Products",
    docId: "get-showcase-products-202405",
    docUrl: "https://partner.tiktokshop.com/docv2/page/get-showcase-products-202405",
    en: "This API lists the products in the creator's showcase, paginated by specified page size and iterated through pages by page token for up to 2000 products in the showcase. This API is generally used when a creator would like to view the products in the showcase.  The platform will return the product details in the showcase, as well as the products in the livebag if the creator is live streaming.",
    vi: "Liệt kê sản phẩm trong showcase của chính creator đã uỷ quyền, tối đa 2.000 sản phẩm, phân trang bằng page_size + page_token. Nếu creator đang livestream thì trả về cả sản phẩm trong giỏ live.",
    scope: { key: "creator.showcase.read", name: "Read Showcase Products", packageId: 791236,
      en: "The application will be able to access up to 2000 products in the creators showcase.",
      vi: "Ứng dụng sẽ truy cập được tối đa 2000 sản phẩm trong showcase của creator." },
  },
  target_collaborations: {
    method: "POST",
    path: "/affiliate_creator/202405/target_collaborations/search",
    title: "Search Creator Target Collaborations",
    docId: "search-creator-target-collaborations-202405",
    docUrl: "https://partner.tiktokshop.com/docv2/page/search-creator-target-collaborations-202405",
    en: "Searches for the authenticated creator's target collaborations and the products within them for the TikTok Shop specified by `shop_id`.",
    vi: "Tìm các chiến dịch hợp tác chỉ định (target collaboration) của chính creator đã uỷ quyền, cùng sản phẩm trong đó, GIỚI HẠN trong một shop chỉ định bằng `shop_id`.",
    scope: { key: "creator.affiliate_collaboration.read", name: "Read Creator Affiliate Collaborations", packageId: 1021508,
      en: "The application will be able to get details regarding your collaborations, including searching collaborations, tracking collaboration performance, receiving collaboration detaiIs and updates, and querying sample applications and related fulfillment details.",
      vi: "Ứng dụng sẽ lấy được chi tiết về các chiến dịch hợp tác của bạn, gồm tìm kiếm hợp tác, theo dõi hiệu quả hợp tác, nhận chi tiết và cập nhật hợp tác, và truy vấn yêu cầu hàng mẫu cùng chi tiết thực hiện liên quan." },
  },
};

export const CREATOR_FIELDS = {
  creator_profile: {
    "username": {
      type: "string",
      en: "The TikTok user name.",
      vi: "Username TikTok của creator. Đây là khoá nối sang bảng creators (cap_order chỉ trả về creator_username, không có open_id).",
    },
    "creator_user_open_id": {
      type: "string",
      en: "Creator Open ID. [More details](https://partner.tiktokshop.com/docv2/page/3obfokj6)",
      vi: "Open ID của creator — định danh ổn định, khác username (username đổi được).",
    },
    "selection_region": {
      type: "string",
      en: "The region in which the creator is eligible to promote products in showcases, videos, and live streams.",
      vi: "Khu vực creator được phép quảng bá sản phẩm trong showcase, video và livestream.",
    },
    "register_region": {
      type: "string",
      en: "The region in which the creator's TikTok account is registered.",
      vi: "Khu vực tài khoản TikTok của creator được đăng ký.",
    },
    "seller_type": {
      type: "string",
      en: "If the creator is also also has a TikTok Shop seller account, the seller type of the creator. This is an enumerated type with values:\n- CROSS_BORDER\n- LOCAL",
      vi: "Nếu creator đồng thời có tài khoản seller TikTok Shop thì đây là loại seller: CROSS_BORDER (bán xuyên biên giới) hoặc LOCAL (bán nội địa).",
    },
    "user_type": {
      type: "string",
      en: "The creator's user type. This is an enumerated type with values:\n- TIKTOK_SHOP_OFFICIAL_ACCOUNT\n- TIKTOK_MARKETING_ACCOUNT\n- TIKTOK_SHOP_CREATOR",
      vi: "Loại tài khoản của creator: TIKTOK_SHOP_OFFICIAL_ACCOUNT, TIKTOK_MARKETING_ACCOUNT hoặc TIKTOK_SHOP_CREATOR.",
    },
    "permissions": {
      type: "[]string",
      en: "A list of product promotion permissions for the creator. The list can include zero or more of the following permissions:\n- LIVE_STREAM_PERMISSION\n- SELF_SALE_PERMISSION\n- ADD_AFFILIATE_PERMISSION\n- PHOTO_SHOPPABLE_PERMISSION_PRODUCT\n- PHOTO_SHOPPABLE_PERMISSION_SHOP",
      vi: "Danh sách quyền quảng bá sản phẩm của creator: LIVE_STREAM_PERMISSION (live), SELF_SALE_PERMISSION (tự bán), ADD_AFFILIATE_PERMISSION (thêm sản phẩm affiliate), PHOTO_SHOPPABLE_PERMISSION_PRODUCT / PHOTO_SHOPPABLE_PERMISSION_SHOP (ảnh gắn sản phẩm/shop). Danh sách có thể rỗng.",
    },
    "avatar.url": {
      type: "string",
      en: "The URL for the TikTok creator's avatar image file.",
      vi: "URL ảnh đại diện của creator.",
    },
  },
  sample_applications: {
    "q:page_size": {
      type: "int",
      en: "The value of \"page_size\" must be greater than 0 and less than or equal to 50.\nDefault 20",
      vi: "Số dòng mỗi trang: lớn hơn 0 và tối đa 50 (mặc định 20). Lưu ý TRẦN KHÁC cap_order/search (100).",
    },
    "q:page_token": {
      type: "string",
      en: "The page token returned in `next_page_token` by the previous response. Omit this parameter for the first request. For subsequent pages, pass the returned token and reuse the same `application_statuses` value.",
      vi: "Token phân trang lấy từ `next_page_token` của response trước. Bỏ qua ở trang đầu; các trang sau phải truyền lại token VÀ giữ nguyên `application_statuses`.",
    },
    "b:application_statuses": {
      type: "[]string",
      en: "Filter sample applications by status.\nThe possible enumerated values are:\n- PENDING: The sample application is waiting for the seller's review.\n- AWAITING_SHIPMENT: The application is approved, and the seller needs to ship the sample.\n- SHIPPED: The sample has been shipped by the seller and is waiting for the creator to receive the package.\n- CONTENT_PENDING: The creator has received the sample package and is expected to create content.\n- REJECT_CANCELLED: The sample application has been rejected by the seller.\n- OVERDUE_CANCELLED: The sample application has expired due to being overdue.\n- UNFULFILL_CANCELLED: The creator did not fulfill the commitment to create content within the agreed timeframe.\n- FULFILLMENT_SUSPEND: The application fulfillment was paused because the product could not be promoted.\n- DEL_OPEN_COLLAB: Open collaboration has been deleted.\n- SELLER_NOT_SHIP_CANCELLED: The seller did not ship the sample within the required timeframe.\n- WITHDRAW_CANCELLED: The creator withdrew the sample application before the seller approved it.\n- UNFULFILLABLE_CANCELLED: The application was cancelled due to reasons beyond the creator's control, making it impossible to create content.\n- OPS_CANCELLED: The application was manually cancelled by operations staff.\n- OPS_FAILED: The application was marked as failed by operations staff.\n- OPS_ COMPLETED: The application was manually marked as completed by operations staff.\n- COMPLETED: The application is complete, and the creator has posted the content.\n- TO_BE_POST: The creator has not posted a video or LIVE for this sample.\n- POST_IN_REVIEW: The creator has posted a video or LIVE that has not yet satisfied the fulfillment requirements.\n- POST_FAILED: The creator posted a video or LIVE but deleted it before completing sample fulfillment.\n- CANCELED: The sample application has been canceled.\nThis field allows for tracking the status of a sample application throughout its lifecycle, providing visibility into each stage of the process for sellers and creators.",
      vi: "Lọc yêu cầu hàng mẫu theo trạng thái. Bỏ trống để lấy mọi trạng thái.",
    },
    "sample_applications": {
      type: "[]object",
      en: "The sample application information.",
      vi: "Danh sách yêu cầu hàng mẫu.",
    },
    "sample_applications.id": {
      type: "string",
      en: "The unique id of sample application.",
      vi: "Mã định danh của yêu cầu hàng mẫu. Dùng làm khoá chính của bảng thô.",
    },
    "sample_applications.status": {
      type: "string",
      en: "The status of sample applications.\nThe possible enumerated values are:\n- PENDING: The sample application is waiting for the seller's review.\n- AWAITING_SHIPMENT: The application is approved, and the seller needs to ship the sample.\n- SHIPPED: The sample has been shipped by the seller and is waiting for the creator to receive the package.\n- REJECT_CANCELLED: The sample application has been rejected by the seller.\n- OVERDUE_CANCELLED: The sample application has expired due to being overdue.\n- UNFULFILL_CANCELLED: The creator did not fulfill the commitment to create content within the agreed timeframe.\n- FULFILLMENT_SUSPEND: the application fulfillment was paused due to the product status being unpromotable.\n- DEL_OPEN_COLLAB: Open collaboration has been deleted.\n- SELLER_NOT_SHIP_CANCELLED: The seller did not ship the sample within the required timeframe.\n- WITHDRAW_CANCELLED: The creator withdrew the sample application before the seller approved it.\n- UNFULFILLABLE_CANCELLED: The application was cancelled due to reasons beyond the creator's control, making it impossible to create content.\n- OPS_CANCELLED: The application was manually cancelled by operations staff.\n- OPS_FAILED: The application was marked as failed by operations staff.\n- OPS_ COMPLETED: The application was manually marked as completed by operations staff.\n- COMPLETED: The application is complete, and the creator has posted the content.\n- TO_BE_POST: the creator has not posted videos/lives for this sample\n- POST_IN_REVIEW: the creator has posted videos/lives which have not satisfied fulfillment rules.\n- POST_FAILED: the creator has posted videos/lives and deleted them before completing sample fulfillment.\n- CANCELED: this application(order) has been canceled.\nThis field allows tracking the status of a sample application throughout its lifecycle, providing visibility into each stage of the process for sellers and creators.",
      vi: "Trạng thái của yêu cầu hàng mẫu, trải suốt vòng đời: chờ seller duyệt (PENDING), chờ gửi (AWAITING_SHIPMENT), đã gửi (SHIPPED), hoàn tất (COMPLETED), cùng hàng loạt trạng thái huỷ khác nhau.",
    },
    "sample_applications.main_order_id": {
      type: "string",
      en: "The sample order is generated after the sample application is approved by seller.",
      vi: "Mã đơn hàng mẫu, chỉ sinh ra SAU KHI seller duyệt yêu cầu. Yêu cầu còn chờ duyệt sẽ không có trường này.",
    },
    "sample_applications.activity_id": {
      type: "string",
      en: "The sample activity identifier id(only for sample activity).",
      vi: "Mã chiến dịch hàng mẫu (chỉ có với sample activity).",
    },
    "sample_applications.sample_product.id": {
      type: "string",
      en: "The product identifier.",
      vi: "Mã sản phẩm được xin mẫu. Cùng hệ product_id với cap_order, nên nối được sang bảng sku_orders.",
    },
    "sample_applications.sample_product.sku_id": {
      type: "string",
      en: "The SKU identifier.",
      vi: "Mã SKU được xin mẫu.",
    },
    "sample_applications.creator_fulfillment.id": {
      type: "string",
      en: "Fulfillment ID.",
      vi: "Mã bản ghi nghĩa vụ thực hiện (làm nội dung) gắn với yêu cầu hàng mẫu này.",
    },
    "sample_applications.creator_fulfillment.status": {
      type: "string",
      en: "Fulfillment status, It indicates the current status of the fulfillment process. The possible values are:\n- PENDING: The creator is yet to fulfill the content creation obligation.\n- ONGOING: Fulfillment is in progress; content has been created and is being evaluated against criteria.\n- SUCCEED: Fulfillment has been successfully completed; the content meets the required standards.\n- FAILED: Fulfillment failed; the content did not meet the required standards.\n- OVERDUE: Fulfillment is overdue; the creator did not meet the deadline.\n- SUSPEND: Fulfillment has been suspended.\n- CANCELLED: Fulfillment has been cancelled, either by the creator or due to operational reasons.\n- EXEMPTED: The creator has been exempted from the fulfillment obligation.",
      vi: "Trạng thái thực hiện nghĩa vụ làm nội dung: PENDING (chưa làm), ONGOING (đang xét nội dung), SUCCEED (đạt), FAILED (không đạt), OVERDUE (quá hạn), SUSPEND (tạm dừng), CANCELLED (đã huỷ), EXEMPTED (được miễn).",
    },
    "sample_applications.creator_fulfillment.expiration_time": {
      type: "int",
      en: "Fulfillment deadline timestamp, in seconds.",
      vi: "Unix timestamp (giây) hạn cuối phải hoàn thành nghĩa vụ làm nội dung.",
    },
    "sample_applications.creator_fulfillment.bound_product_status": {
      type: "string",
      en: "Represents the marketing status of a product associated with a fulfillment order. It indicates whether the product is available for marketing and fulfillment. The possible values are:\n- UNKNOWN: The marketing status of the product is unknown.\n- LIVE: The product is available and can be used for fulfillment.\n- OUT_OF_STOCK: The product is out of stock and cannot be fulfilled.\n- SELLER_DEACTIVATE: The product has been deactivated by the seller.\n- PLATFORM_DEACTIVATE: The product has been deactivated by the platform.\n- NO_PLAN: There is no valid plan available for the creator to market the product.\n- PERMANENT_DELETED: The product has been permanently deleted and is no longer available.\nThis field helps sellers and creators understand the current status of products associated with fulfillment orders, ensuring that all parties are aware of the availability and marketing status of the products involved in sample applications and collaborations.",
      vi: "Trạng thái quảng bá của sản phẩm gắn với nghĩa vụ này: LIVE (quảng bá được), OUT_OF_STOCK, SELLER_DEACTIVATE, PLATFORM_DEACTIVATE, NO_PLAN, PERMANENT_DELETED, UNKNOWN.",
    },
    "next_page_token": {
      type: "string",
      en: "Page token to query next page orders, last page is empty string.",
      vi: "Token để lấy trang kế tiếp; trang cuối trả về chuỗi rỗng. Lưu ý KHÁC cap_order/search (ở đó trường này biến mất thay vì rỗng).",
    },
  },
  showcase_products: {
    "q:page_size": {
      type: "int",
      en: "The number of results to be returned per page. Valid range: [1-20].",
      vi: "Số sản phẩm mỗi trang. BẮT BUỘC, khoảng hợp lệ [1-20] — nhỏ hơn hẳn các endpoint khác, nên showcase 2.000 sản phẩm cần tới 100 request.",
    },
    "q:page_token": {
      type: "string",
      en: "An opaque token used to retrieve the next page of a paginated result set. Retrieve this value from the result of the next_page_token from a previous response. It is not needed for the first page.",
      vi: "Token phân trang lấy từ `next_page_token` của response trước. Không cần ở trang đầu.",
    },
    "q:origin": {
      type: "string",
      en: "Set to `LIVE` to indicate the request originates from a Live room. Set to `SHOWCASE` to indicate that the request originates from the Showcase.",
      vi: "BẮT BUỘC. `SHOWCASE` = lấy sản phẩm trong showcase; `LIVE` = lấy theo ngữ cảnh phòng live. Giá trị này đổi nghĩa của `added_status`.",
    },
    "products": {
      type: "[]object",
      en: "A list of products.",
      vi: "Danh sách sản phẩm.",
    },
    "products.id": {
      type: "string",
      en: "The product's product ID",
      vi: "product_id của sản phẩm. Cùng hệ với product_id của cap_order, nên nối được sang sku_orders để biết sản phẩm nào treo mà CHƯA bán được.",
    },
    "products.title": {
      type: "string",
      en: "The product's display title.",
      vi: "Tên sản phẩm hiển thị.",
    },
    "products.shop.name": {
      type: "string",
      en: "The TikTok Shop name.",
      vi: "Tên shop. Giống cap_order: chỉ có tên, KHÔNG có shop_id.",
    },
    "products.status.inventory_status": {
      type: "string",
      en: "The product inventory status. This an enumerated type with values:\n- IN_STOCK\n- SOLD_OUT",
      vi: "Trạng thái tồn kho: IN_STOCK hoặc SOLD_OUT.",
    },
    "products.status.review_status": {
      type: "string",
      en: "The product review status. This is an enumerated type with values:\n- APPROVED\n- UNDER_REVIEW\n- CHANGES_UNDER_REVIEW\n- UNAVAILABLE\n- REJECTED\n- ZERO_COMMISSION",
      vi: "Trạng thái xét duyệt sản phẩm: APPROVED, UNDER_REVIEW, CHANGES_UNDER_REVIEW, UNAVAILABLE, REJECTED, ZERO_COMMISSION.",
    },
    "products.status.is_hidden": {
      type: "bool",
      en: "Set to `false` if the product is visible in the showcase. Set to `true` if the product is hidden from the showcase.",
      vi: "`false` = sản phẩm đang hiện trong showcase; `true` = đang bị ẩn.",
    },
    "products.status.added_status": {
      type: "string",
      en: "The product's add status for the request origin. For `SHOWCASE`, `ADDED` indicates that the product is in the showcase, while `REJECTED` indicates that the product is rejected for use in the current context. For `LIVE`, `ADDED` means the product is already in the Live room's product list (live bag), `NOT_ADDED` means the product can be added, and `REJECTED` means the product cannot be added.",
      vi: "Trạng thái thêm sản phẩm, NGHĨA PHỤ THUỘC `origin`. Với `SHOWCASE`: ADDED = đang trong showcase, REJECTED = bị từ chối. Với `LIVE`: ADDED = đã có trong giỏ live, NOT_ADDED = thêm được, REJECTED = không thêm được.",
    },
    "products.source": {
      type: "string",
      en: "The product source. This is an enumerated type with values:\n- THIRD_PARTY\n- AFFILIATE\n- TIKTOK_STORE",
      vi: "Nguồn sản phẩm: THIRD_PARTY, AFFILIATE hoặc TIKTOK_STORE.",
    },
    "products.sale_regions": {
      type: "[]string",
      en: "A list of regions in which the product is offered for sale.",
      vi: "Danh sách khu vực sản phẩm được bán.",
    },
    "products.commission.rate": {
      type: "int",
      en: "The commission rate in hundredths of a percent. For example, `3587` is a commission rate of `35.87%`. The range of this value is [100, 8000].",
      vi: "Tỷ lệ hoa hồng tính theo điểm cơ bản: 3587 = 35,87%. Khoảng hợp lệ [100, 8000]. Cùng đơn vị với standard_commission_rate của cap_order.",
    },
    "products.commission.reward_rate": {
      type: "int",
      en: "The reward commission rate in hundredths of a percent. For example, `3587` is a commission rate of `35.87%`.",
      vi: "Tỷ lệ hoa hồng thưởng, cũng theo điểm cơ bản: 3587 = 35,87%.",
    },
    "products.collaboration.id": {
      type: "string",
      en: "The collaboration identifier.",
      vi: "Mã chiến dịch hợp tác gắn với sản phẩm.",
    },
    "products.collaboration.type": {
      type: "string",
      en: "The collaboration type. This an enumerated type with values:\n1 - Open Collaboration\n2 - Target Collaboration\n5 - Partner Campaign\n11 - Flat Fee\n12 - Collaboration Plus\n13 - Affiliate Promotion",
      vi: "Loại hợp tác: 1 Open Collaboration, 2 Target Collaboration, 5 Partner Campaign, 11 Flat Fee, 12 Collaboration Plus, 13 Affiliate Promotion.",
    },
    "total_count": {
      type: "int",
      en: "Total count of products in the response.",
      vi: "Tổng số sản phẩm trong response.",
    },
    "next_page_token": {
      type: "string",
      en: "An opaque token used to retrieve the next page of a paginated result set.",
      vi: "Token phân trang để lấy trang kế tiếp.",
    },
  },
  target_collaborations: {
    "q:page_size": {
      type: "int",
      en: "The number of results to be returned per page. Valid range: [0-100].",
      vi: "Số dòng mỗi trang. BẮT BUỘC, khoảng hợp lệ [0-100].",
    },
    "q:page_token": {
      type: "string",
      en: "An opaque token used to retrieve the next page of a paginated result set. It is not needed for the first page. For each subsequent page, pass the previous response's `next_page_token` unchanged as `page_token` and reuse the same `page_size`, `shop_id`, `keyword`, and `keyword_type` values, including whether optional `keyword` and `keyword_type` were omitted or provided.",
      vi: "Token phân trang lấy từ `next_page_token` của response trước. Các trang sau phải giữ nguyên `page_size`, `shop_id`, `keyword`, `keyword_type` — kể cả việc có truyền hay bỏ trống hai trường keyword.",
    },
    "b:shop_id": {
      type: "string",
      en: "The TikTok Shop identifier.",
      vi: "BẮT BUỘC: mã shop TikTok Shop. Đây là CHẶN LỚN NHẤT của endpoint này — cap_order/search chỉ trả shop_name chứ không có shop_id, nên không suy ra được danh sách shop_id từ dữ liệu đang có.",
    },
    "b:keyword_type": {
      type: "string",
      en: "The type of value specified in `keyword`. Provide `keyword` and `keyword_type` together to filter by ID or name. Omit both fields to search without an ID or name filter. Possible values:\n- `TARGET_COLLABORATIONS_ID`: Match by target collaboration ID and return matching collaborations in the `LIVE`, `EXPIRED`, `DELETED`, or `ENDED` state.\n- `TARGET_COLLABORATIONS_NAME`: Match by target collaboration name and return matching collaborations in the `LIVE` state only.",
      vi: "Loại giá trị truyền trong `keyword`. TARGET_COLLABORATIONS_ID tìm theo mã và trả cả chiến dịch LIVE/EXPIRED/DELETED/ENDED; TARGET_COLLABORATIONS_NAME tìm theo tên và CHỈ trả chiến dịch LIVE.",
    },
    "b:keyword": {
      type: "string",
      en: "The target collaboration ID or name to search for, as specified by `keyword_type`. For `TARGET_COLLABORATIONS_ID`, provide a base-10 integer. For `TARGET_COLLABORATIONS_NAME`, provide a value shorter than 500 bytes.",
      vi: "Mã hoặc tên chiến dịch cần tìm, theo `keyword_type`. Bỏ cả hai trường keyword để lấy không lọc.",
    },
    "target_collaborations": {
      type: "[]object",
      en: "A list of target collaboration objects.",
      vi: "Danh sách chiến dịch hợp tác chỉ định.",
    },
    "target_collaborations.id": {
      type: "string",
      en: "The target collaboration identifier.",
      vi: "Mã chiến dịch hợp tác chỉ định. Cùng hệ với target_collaboration_id của cap_order, nên nối được sang sku_orders để biết chiến dịch nào đã ra đơn.",
    },
    "target_collaborations.name": {
      type: "string",
      en: "The target collaboration name.",
      vi: "Tên chiến dịch hợp tác chỉ định.",
    },
    "target_collaborations.status": {
      type: "string",
      en: "The target collaboration state. This is an enumerated type with values:\n- LIVE\n- EXPIRED\n- DELETED\n- ENDED",
      vi: "Trạng thái chiến dịch: LIVE (đang chạy), EXPIRED (hết hạn), DELETED (đã xoá), ENDED (đã kết thúc).",
    },
    "target_collaborations.products": {
      type: "[]object",
      en: "A list of products associated with the target collaboration.",
      vi: "Danh sách sản phẩm thuộc chiến dịch.",
    },
    "target_collaborations.products.id": {
      type: "string",
      en: "The product identifier.",
      vi: "Mã sản phẩm trong chiến dịch.",
    },
    "target_collaborations.products.title": {
      type: "string",
      en: "The product name.",
      vi: "Tên sản phẩm.",
    },
    "target_collaborations.products.commission.rate": {
      type: "int",
      en: "The commission rate for the target collaboration in hundredths of a percent. For example, `3587` is a commission rate of `35.87%`.",
      vi: "Tỷ lệ hoa hồng của sản phẩm trong chiến dịch này, theo điểm cơ bản: 3587 = 35,87%.",
    },
    "target_collaborations.products.commission.amount": {
      type: "string",
      en: "The estimated commission amount calculated from the product's minimum price, in the currency specified by `currency`.",
      vi: "Hoa hồng ước tính, tính từ GIÁ THẤP NHẤT của sản phẩm — không phải giá thực bán, nên đừng dùng thay cho est_commission của cap_order.",
    },
    "target_collaborations.products.commission.currency": {
      type: "string",
      en: "The currency code.",
      vi: "Mã loại tiền của `amount`.",
    },
    "total_count": {
      type: "int",
      en: "The total number of target collaborations that match the search criteria.",
      vi: "Tổng số chiến dịch khớp điều kiện tìm kiếm.",
    },
    "next_page_token": {
      type: "string",
      en: "An opaque token used to retrieve the next page of a paginated result set.",
      vi: "Token phân trang để lấy trang kế tiếp.",
    },
  },
};
