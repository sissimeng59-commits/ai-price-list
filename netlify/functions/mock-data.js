function analyzeShopping(input) {
  const normalized = String(input || "").trim();

  if (normalized.includes("得宝")) {
    return {
      status: "direct_price_search",
      reason: "你已经给出明确品牌，适合直接进入补贴价查询。",
      priceKeyword: "得宝 卷纸 27卷 618 补贴"
    };
  }

  if (normalized.includes("婴儿车")) {
    return {
      status: "need_questions",
      reason: "婴儿车涉及年龄、使用场景、预算和收纳，先确认关键条件更合适。",
      questions: [
        { id: "age", label: "宝宝多大？", options: ["新生儿", "6个月以上", "1岁以上"] },
        { id: "scene", label: "主要怎么用？", options: ["小区散步", "经常出门", "旅行收纳"] },
        { id: "budget", label: "预算大概？", options: ["1000以内", "1000-2500", "2500以上"] }
      ]
    };
  }

  if (normalized.includes("卷纸")) {
    return toiletPaperRecommendations();
  }

  return {
    status: "need_recommendation",
    reason: "你给的是品类需求，建议先选购买方向，再进入查价。",
    recommendations: [
      {
        name: "高性价比囤货款",
        audience: "预算优先、家里用量大、想趁 618 多囤一点",
        brands: "京东京造、维达、洁柔、蓝漂",
        keyword: `${normalized} 高性价比 618 补贴`
      },
      {
        name: "品质稳妥款",
        audience: "给家人长期用，想少踩坑",
        brands: "维达、清风、心相印、得宝",
        keyword: `${normalized} 品质款 618 补贴`
      }
    ]
  };
}

function toiletPaperRecommendations() {
  return {
    status: "need_recommendation",
    reason: "你想买卷纸但还没确定品牌和规格，先按使用偏好选类型。",
    recommendations: [
      {
        name: "家用性价比囤货装",
        audience: "一家人日常高频使用，想看单卷价",
        brands: "维达、洁柔、清风、京东京造",
        keyword: "卷纸 4层 加厚 24卷 27卷 618 补贴"
      },
      {
        name: "柔软厚实品质款",
        audience: "对手感、厚度、掉屑更敏感",
        brands: "得宝、心相印茶语、维达棉韧",
        keyword: "得宝 心相印 维达 棉韧 卷纸 618 补贴"
      },
      {
        name: "母婴家庭安心款",
        audience: "家里有宝宝或长辈，关注原生木浆和无香",
        brands: "可心柔、babycare、全棉时代",
        keyword: "母婴 卷纸 原生木浆 无香 618 补贴"
      }
    ]
  };
}

function searchPrice({ keyword, originalInput, selectedOption }) {
  const query = keyword || (selectedOption && selectedOption.keyword) || originalInput || "";
  const isPaper = query.includes("卷纸") || String(originalInput || "").includes("卷纸");

  return {
    keyword: query,
    notice: "AI 查询价仅供参考，最终以打开页面为准。",
    items: isPaper ? toiletPaperPrices() : generalPrices(query)
  };
}

function toiletPaperPrices() {
  return [
    {
      platform: "京东",
      spec: "27卷装",
      estimatedPrice: "¥74.9-¥79.9",
      unitPrice: "¥2.77-¥2.96/卷",
      discount: "PLUS会员95折+满减+品牌券",
      suggestion: "首选，物流快，售后好。",
      url: "https://www.jd.com/",
      needManualConfirm: true
    },
    {
      platform: "天猫/淘宝",
      spec: "24-27卷装",
      estimatedPrice: "¥72-¥85",
      unitPrice: "¥2.67-¥3.15/卷",
      discount: "店铺券+跨店满减+88VIP",
      suggestion: "品牌旗舰店更稳，注意是否同规格同层数。",
      url: "https://www.taobao.com/",
      needManualConfirm: true
    },
    {
      platform: "拼多多",
      spec: "24卷装",
      estimatedPrice: "¥65-¥69",
      unitPrice: "¥2.70-¥2.87/卷",
      discount: "百亿补贴+平台券",
      suggestion: "追求低价可选，需要确认店铺资质。",
      url: "https://www.pinduoduo.com/",
      needManualConfirm: true
    },
    {
      platform: "线下商超",
      spec: "10-18卷装",
      estimatedPrice: "¥39.9-¥69.9",
      unitPrice: "¥3.20-¥4.20/卷",
      discount: "会员价+门店满减",
      suggestion: "适合临时补货，囤货价通常不如线上。",
      url: "https://map.baidu.com/",
      needManualConfirm: true
    }
  ];
}

function generalPrices(query) {
  return [
    {
      platform: "京东",
      spec: "主流热卖规格",
      estimatedPrice: "¥199-¥239",
      unitPrice: "按规格确认",
      discount: "PLUS会员价+满减+品类券",
      suggestion: "适合看自营和售后，先确认型号一致。",
      url: "https://www.jd.com/",
      needManualConfirm: true
    },
    {
      platform: "天猫/淘宝",
      spec: "旗舰店常规规格",
      estimatedPrice: "¥189-¥249",
      unitPrice: "按规格确认",
      discount: "店铺券+跨店满减",
      suggestion: "适合看旗舰店活动，注意赠品是否计入价格。",
      url: "https://www.taobao.com/",
      needManualConfirm: true
    },
    {
      platform: "拼多多",
      spec: "补贴款规格",
      estimatedPrice: "¥179-¥229",
      unitPrice: "按规格确认",
      discount: "百亿补贴+平台券",
      suggestion: "低价优先可看，重点确认店铺和售后。",
      url: "https://www.pinduoduo.com/",
      needManualConfirm: true
    }
  ];
}

exports.analyzeShopping = analyzeShopping;
exports.searchPrice = searchPrice;
