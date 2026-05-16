import os
import requests
import uuid
import datetime
from flask import Flask, request, jsonify, send_from_directory, abort
from flask_cors import CORS
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

# =============================================================================
# [1] CONFIGURATIONS
# =============================================================================

MERCHANT_NAME  = os.getenv("MERCHANT_NAME")
MERCHANT_CITY  = os.getenv("MERCHANT_CITY", "Phnom Penh")
MERCHANT_PHONE = os.getenv("MERCHANT_PHONE")

CAMRAPIDPAY_API_KEY     = os.getenv("CAMRAPIDPAY_API_KEY")
CAMRAPIDPAY_BASE_URL    = os.getenv("CAMRAPIDPAY_BASE_URL", "https://pay.camrapidpay.com")
CAMRAPIDPAY_SUCCESS_URL = os.getenv("CAMRAPIDPAY_SUCCESS_URL", "")
CAMRAPIDPAY_WEBHOOK_URL = os.getenv("CAMRAPIDPAY_WEBHOOK_URL")

CAMRAPID_API_KEY    = os.getenv("CAMRAPID_API_KEY")
URL_USER_PROFILE    = os.getenv("CAMRAPID_URL_PROFILE",         "https://partner.camrapidsecure.com/api/User_Profile.php")
URL_PRODUCT_LIST    = os.getenv("CAMRAPID_URL_PRODUCTS",        "https://partner.camrapidsecure.com/api/Product_Show.php")
URL_CREATE_ORDER    = os.getenv("CAMRAPID_URL_CREATE_ORDER",    "https://partner.camrapidsecure.com/api/Create_Orders.php")
URL_FUNDING_HIST    = os.getenv("CAMRAPID_URL_FUNDING_HISTORY", "https://partner.camrapidsecure.com/api/Funding_History.php")
URL_ORDERS_HIST     = os.getenv("CAMRAPID_URL_ORDERS_HISTORY",  "https://partner.camrapidsecure.com/api/Orders_History.php")

# NOTE: FF now uses the same direct delivery endpoint as MLBB — no OTP required
# URL_FF_REQUEST_OTP and URL_FF_SUBMIT_ORDER are removed intentionally

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_GROUP_ID  = os.getenv("TELEGRAM_GROUP_ID")

# =============================================================================
# [2] DATABASE
# =============================================================================

mongo_client = MongoClient(os.getenv("MONGO_URI"))
db           = mongo_client[os.getenv("MONGO_DB_NAME", "irra_topup_db")]
orders_col   = db["orders"]

# =============================================================================
# [3] CAMRAPIDPAY HELPERS
# =============================================================================

def camrapidpay_create_payment(amount: float, reference: str) -> dict:
    payload = {
        "api_key":     CAMRAPIDPAY_API_KEY,
        "amount":      amount,
        "reference":   reference,
        "webhook_url": CAMRAPIDPAY_WEBHOOK_URL,
    }
    if CAMRAPIDPAY_SUCCESS_URL:
        payload["success_url"] = CAMRAPIDPAY_SUCCESS_URL
    resp = requests.post(
        f"{CAMRAPIDPAY_BASE_URL}/api/v1/khqr/create-payments",
        json=payload,
        timeout=20,
    )
    if not resp.ok:
        raise ValueError(f"CamRapidPay API error {resp.status_code}: {resp.text}")
    data = resp.json()
    if not data.get("success"):
        raise ValueError(f"CamRapidPay error: {data.get('message', 'Unknown error')}")
    return data


def camrapidpay_check_payment(reference: str) -> str:
    resp = requests.get(
        f"{CAMRAPIDPAY_BASE_URL}/check-transaction-api",
        params={"api_key": CAMRAPIDPAY_API_KEY, "reference": reference},
        headers={"Accept": "application/json"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json().get("status", "Pending")

# =============================================================================
# [4] PRODUCT IMAGES
# =============================================================================

IMG = {
    "diamond":    "https://www.netonlinestores.com/_next/image?url=https%3A%2F%2Fnet-cms.minttopup.xyz%2Fuploads%2FMLBB_1_8297da66a4.png&w=828&q=75",
    "diamond1":   "https://i.postimg.cc/0jQfrXRY/22.png",
    "diamondbox": "https://i.postimg.cc/90tZCvfF/44.webp",
    "weekly":     "https://static.saktopup.com/bundles/image_20260202_220625_55a8e44742404f8cad936ec8df7afff0.png",
    "weekly1":    "https://static.saktopup.com/bundles/image_20260202_221002_422b727871cf4edd9616afc43eaa1fd0.png",
    "twilight":   "https://i.pinimg.com/736x/d6/15/22/d6152235c3a1be7da7fcdb515be41dc0.jpg",
    "elite":      "https://partner.camrapidsecure.com/admin/uploads/products/1769778370_1000096893.png",
    "epic":       "https://partner.camrapidsecure.com/admin/uploads/products/1769778415_1000096894.png",
    "jren":       "https://i.postimg.cc/L5Lsk2p2/11.png",
}

FF_IMG = {
    "diamond": "https://partner.camrapidsecure.com/admin/uploads/products/1770954932_1000093842.png",
    "weekly":  "https://partner.camrapidsecure.com/admin/uploads/products/1772893533_68a3ba094a9fd.png",
    "monthly": "https://partner.camrapidsecure.com/admin/uploads/products/1772894005_2.png",
    "evo":     "https://i.postimg.cc/7hSWM8Xv/1760873621-1000081599.png",
    "uplevel": "https://i.postimg.cc/133GvRdg/1762017948-1000082991-removebg-preview.png",
    "lite": "https://partner.camrapidsecure.com/admin/uploads/products/1764957456_1000087705.png",
}

# =============================================================================
# [5] PACKAGES — MLBB KH
# =============================================================================

MLBB_KH_PACKAGES = [
     # ── Passes ────────────────────────────────────────────────────────────────
    { "id": 157, "name": "Weekly Pass x1",       "price": 1.55,  "skuCode": "SMU_WeeklyBR",         "image": IMG["weekly"]     },
    { "id": 150, "name": "Weekly Pass x2",        "price": 3.10,  "skuCode": "SMU_Weeklyx2",       "image": IMG["weekly"]     },
    { "id": 151, "name": "Weekly Pass x3",        "price": 4.65,  "skuCode": "SMU_Weeklyx3",       "image": IMG["weekly"]     },
    { "id": 152, "name": "Weekly Pass x4",        "price": 6.20,  "skuCode": "SMU_Weeklyx4",       "image": IMG["weekly"]     },
    { "id": 153, "name": "Weekly Pass x5",        "price": 7.75,  "skuCode": "SMU_Weeklyx5",       "image": IMG["weekly"]     },
    { "id": 208, "name": "Elite Weekly",          "price": 0.89,  "skuCode": "EliteWeekly",        "image": IMG["elite"]      },
    { "id": 209, "name": "Epic Monthly",          "price": 4.30,  "skuCode": "EpicMonthly",        "image": IMG["epic"]       },
    # ── Multi-Pass Bundles ─────────────────────────────────────────────────────
    { "id": 158, "name": "Weekly + 257 Diamonds", "price": 5.10,  "skuCode": "SMU_257xWeekly",     "image": IMG["weekly1"]    },
    { "id": 148, "name": "Weekly + 172 Diamonds", "price": 3.99,  "skuCode": "SMU_172xWeekly",     "image": IMG["weekly1"]    },
    { "id": 155, "name": "Twilight Pass",          "price": 8.15,  "skuCode": "SMU_TwilightPassBR", "image": IMG["twilight"]  },
    # ── Bonus Packs (First Recharge) ──────────────────────────────────────────
    { "id": 140, "name": "50+50(លេីកទី១)",      "price": 0.85,  "skuCode": "SMU_50x50BONUS",     "image": IMG["diamond"]    },
    { "id": 141, "name": "150+150(លេីកទី១)",    "price": 2.50,  "skuCode": "SMU_150x150BONUS",   "image": IMG["diamond"]    },
    { "id": 142, "name": "250+250(លេីកទី១)",    "price": 3.85,  "skuCode": "SMU_250x250BONUS",   "image": IMG["diamond"]    },
    { "id": 143, "name": "500+500(លេីកទី១)",    "price": 7.65,  "skuCode": "SMU_500x500BONUS",   "image": IMG["diamond"]    },
    # ── Diamond Packs ──────────────────────────────────────────────────────────
    { "id": 81,  "name": "11 Diamonds",           "price": 0.25,  "skuCode": "SMU_11DM",           "image": IMG["diamond1"]   },
    { "id": 82,  "name": "22 Diamonds",           "price": 0.50,  "skuCode": "SMU_22DM",           "image": IMG["diamond1"]   },
    { "id": 86,  "name": "86 Diamonds",           "price": 1.35,  "skuCode": "SMU_86DM",           "image": IMG["diamond1"]   },
    { "id": 87,  "name": "172 Diamonds",          "price": 2.70,  "skuCode": "SMU_172DM",          "image": IMG["diamond1"]   },
    { "id": 88,  "name": "257 Diamonds",          "price": 3.79,  "skuCode": "SMU_257DM",          "image": IMG["diamond"]    },
    { "id": 89,  "name": "344 Diamonds",          "price": 4.79,  "skuCode": "SMU_344DM",          "image": IMG["diamond"]    },
    { "id": 90,  "name": "429 Diamonds",          "price": 5.89,  "skuCode": "SMU_429DM",          "image": IMG["diamond"]    },
    { "id": 91,  "name": "514 Diamonds",          "price": 7.10,  "skuCode": "SMU_514DM",          "image": IMG["diamond"]    },
    { "id": 94,  "name": "600 Diamonds",          "price": 8.30,  "skuCode": "SMU_600DM",          "image": IMG["diamond"]    },
    { "id": 95,  "name": "706 Diamonds",          "price": 9.60,  "skuCode": "SMU_706DM",          "image": IMG["diamond"]    },
    { "id": 96,  "name": "792 Diamonds",          "price": 10.70, "skuCode": "SMU_792DM",          "image": IMG["diamond"]    },
    { "id": 97,  "name": "878 Diamonds",          "price": 11.89, "skuCode": "SMU_878DM",          "image": IMG["jren"]       },
    { "id": 98,  "name": "963 Diamonds",          "price": 13.10, "skuCode": "SMU_963DM",          "image": IMG["jren"]       },
    { "id": 99,  "name": "1050 Diamonds",         "price": 14.99, "skuCode": "SMU_1050DM",         "image": IMG["jren"]       },
    { "id": 100, "name": "1136 Diamonds",         "price": 15.50, "skuCode": "SMU_1136DM",         "image": IMG["diamondbox"] },
    { "id": 102, "name": "1222 Diamonds",         "price": 16.50, "skuCode": "SMU_1222DM",         "image": IMG["diamondbox"] },
]
# =============================================================================
# [6] PACKAGES — MLBB PH
# =============================================================================
MLBB_PH_PACKAGES = [
    { "id": 156, "name": "Weekly Pass x1",       "price": 1.79,  "skuCode": "SMU_Weekly",         "image": IMG["weekly"]     },
    { "id": 153, "name": "Weekly Pass x5",        "price": 8.95,  "skuCode": "SMU_Weeklyx5",       "image": IMG["weekly"]     },
    { "id": 81, "name": "11 Diamonds",   "price": 0.25,  "skuCode": "SMU_11DM",   "image": IMG["diamond1"]   },
    { "id": 82, "name": "22 Diamonds",  "price": 0.50,  "skuCode": "SMU_22DM",  "image": IMG["diamond1"]   },
    { "id": 85, "name": "112 Diamonds",  "price": 2.00,  "skuCode": "SMU_112DM",  "image": IMG["diamond"]    },
    { "id": 92, "name": "559 Diamonds",  "price": 8.50,  "skuCode": "SMU_559DM",  "image": IMG["diamond"]    },
    { "id": 101, "name": "1163 Diamonds", "price": 17.50, "skuCode": "SMU_1163DM", "image": IMG["jren"]       },
    { "id": 109, "name": "2539 Diamonds", "price": 40.99, "skuCode": "SMU_2539DM", "image": IMG["diamondbox"] },

]


# =============================================================================
# [7] PACKAGES — FREE FIRE KH
# =============================================================================

FF_PACKAGES = [
    # ── Diamond Packs ─────────────────────────────────────────────────────────
    { "id": 171, "name": "25 Diamonds",    "price": 0.30, "skuCode": "UNGS_FFSG_25DM",        "image": FF_IMG["diamond"] },
    { "id": 213, "name": "100 Diamonds",   "price": 1.00, "skuCode": "UNGS_FFSG_100DM",       "image": FF_IMG["diamond"] },
    { "id": 177, "name": "310 Diamonds",   "price": 2.80, "skuCode": "UNGS_FFSG_310DM",       "image": FF_IMG["diamond"] },
    { "id": 172, "name": "520 Diamonds",   "price": 4.40, "skuCode": "UNGS_FFSG_520DM",       "image": FF_IMG["diamond"] },
    { "id": 173, "name": "1060 Diamonds",  "price": 8.50, "skuCode": "UNGS_FFSG_1060DM",      "image": FF_IMG["diamond"] },
    { "id": 174, "name": "2180 Diamonds",  "price": 16.80, "skuCode": "UNGS_FFSG_2180DM",      "image": FF_IMG["diamond"] },
    { "id": 175, "name": "5600 Diamonds",  "price": 39.99, "skuCode": "UNGS_FFSG_5600DM",      "image": FF_IMG["diamond"] },
    { "id": 176, "name": "11500 Diamonds", "price": 79.99, "skuCode": "UNGS_FFSG_11500DM",     "image": FF_IMG["diamond"] },
    # ── Weekly Passes ─────────────────────────────────────────────────────────
    { "id": 211, "name": "Weekly Pass",    "price": 1.65, "skuCode": "UNGS_FFSG_WEEKLY",      "image": FF_IMG["weekly"]  },
    { "id": 223, "name": "Weekly Pass x2", "price": 3.30, "skuCode": "FFSG_WEEKLY_PASS_X2",   "image": FF_IMG["weekly"]  },
    { "id": 226, "name": "Weekly Pass x5", "price": 8.25, "skuCode": "FFSG_WEEKLY_PASS_X5",   "image": FF_IMG["weekly"]  },
    { "id": 232, "name": "Weekly Pass x10","price": 16.50, "skuCode": "FFSG_WEEKLY_PASS_X10",  "image": FF_IMG["weekly"]  },
    # ── Weekly Lite ────────────────────────────────────────────────────────────
    { "id": 212, "name": "Weekly Lite",    "price": 0.40, "skuCode": "UNGS_FFSG_WEEKLYLITE",  "image": FF_IMG["weekly"]  },
    { "id": 214, "name": "Weekly Lite x2", "price": 0.80, "skuCode": "FFSG_WEEKLITE_X2",      "image": FF_IMG["weekly"]  },
    { "id": 217, "name": "Weekly Lite x5", "price": 2.00, "skuCode": "FFSG_WEEKLYLITE_X5",    "image": FF_IMG["weekly"]  },
    { "id": 222, "name": "Weekly Lite x10","price": 4.00, "skuCode": "FFSG_WEEKLYLITE_X10",   "image": FF_IMG["weekly"]  },
    # ── Monthly Passes ─────────────────────────────────────────────────────────
    { "id": 210, "name": "Monthly Pass",   "price": 7.65, "skuCode": "UNGS_FFSG_Monthly",     "image": FF_IMG["monthly"] },
    { "id": 233, "name": "Monthly x2",     "price": 15.30, "skuCode": "FF_SG_MONTHLY_X2",      "image": FF_IMG["monthly"] },
    { "id": 236, "name": "Monthly x5",     "price": 38.25, "skuCode": "FF_SG_MONTHLY_X5",      "image": FF_IMG["monthly"] },
    { "id": 241, "name": "Monthly x10",    "price": 76.50, "skuCode": "FF_SG_MONTHLY_X10",     "image": FF_IMG["monthly"] },
    #  # ── Evo ─────────────────────────────────────────────────────────
    # { "id": 136, "name": "EVO 3 Days",   "price": 7.65, "skuCode": "UNGS_FFEVO3DAY",     "image": FF_IMG["evo"] },
    # { "id": 137, "name": "EVO 7 Days",     "price": 15.30, "skuCode": "UNGS_FFEVO7DAY",      "image": FF_IMG["evo"] },
    # { "id": 138, "name": "EVO 30 Days",     "price": 38.25, "skuCode": "UNGS_FFEVO30DAY",      "image": FF_IMG["evo"] },
    
]


# FF_PACKAGES = [
#     # ── Special Bundle ────────────────────────────────────────────────────────
    

#     # ── Diamond Packs ─────────────────────────────────────────────────────────
#     { "id": 171, "name": "25 Diamonds",    "price": 0.29, "skuCode": "UNGS_FFSG_25DM",        "image": FF_IMG["diamond"] },
#     # { "id": 125, "name": "25 Diamonds",     "price": 0.30, "skuCode": "UNGS_FF25",            "image": FF_IMG["diamond"] },
#     { "id": 126, "name": "100 Diamonds",    "price": 0.99, "skuCode": "UNGS_FF100",           "image": FF_IMG["diamond"] },
#     { "id": 127, "name": "310 Diamonds",    "price": 2.80, "skuCode": "UNGS_FF310",           "image": FF_IMG["diamond"] },
#     { "id": 128, "name": "520 Diamonds",    "price": 4.40, "skuCode": "UNGS_FF520",           "image": FF_IMG["diamond"] },
#     { "id": 130, "name": "1060 Diamonds",   "price": 8.50, "skuCode": "UNGS_FF1060",          "image": FF_IMG["diamond"] },
#     { "id": 131, "name": "2180 Diamonds",   "price": 16.80, "skuCode": "UNGS_FF2180",         "image": FF_IMG["diamond"] },
#     { "id": 132, "name": "5600 Diamonds",   "price": 39.99, "skuCode": "UNGS_FF5600",         "image": FF_IMG["diamond"] },
#     { "id": 133, "name": "11500 Diamonds",  "price": 79.99, "skuCode": "UNGS_FF11500",        "image": FF_IMG["diamond"] },

#     # ── Weekly Passes ─────────────────────────────────────────────────────────
#     { "id": 134, "name": "Weekly Pass",     "price": 1.65, "skuCode": "UNGS_FFWEEKLY",        "image": FF_IMG["weekly"]  },
#     { "id": 189, "name": "Weekly x2",       "price": 3.30, "skuCode": "UNGS_WEEKLYX2",        "image": FF_IMG["weekly"]  },
#     { "id": 192, "name": "Weekly x5",       "price": 8.25, "skuCode": "UNGS_WEEKLYX5",        "image": FF_IMG["weekly"]  },
#     { "id": 197, "name": "Weekly x10",      "price": 16.50, "skuCode": "UNGS_WEEKLYX10",      "image": FF_IMG["weekly"]  },

#    # ── Weekly Lite ────────────────────────────────────────────────────────────
#     { "id": 139, "name": "Weekly Lite",     "price": 0.40, "skuCode": "UNGS_WEEKLYLITE",      "image": FF_IMG["lite"]  },
#     { "id": 178, "name": "Weekly Lite x2",  "price": 0.80, "skuCode": "UNGS_WEEKLYLITEX2",    "image": FF_IMG["lite"]  },
#     { "id": 182, "name": "Weekly Lite x5",  "price": 2.00, "skuCode": "UNGS_WEEKLYLITEX5",    "image": FF_IMG["lite"]  },
#     { "id": 187, "name": "Weekly Lite x10", "price": 4.00, "skuCode": "UNGS_WEEKLYLITEX10",   "image": FF_IMG["lite"]  },


#     # ── Monthly Passes ─────────────────────────────────────────────────────────
#     { "id": 135, "name": "Monthly Pass",    "price": 7.65, "skuCode": "UNGS_FFMONTHLY",      "image": FF_IMG["monthly"] },
#     { "id": 199, "name": "Monthly x2",      "price": 15.60, "skuCode": "UNGS_MONTHLYX2",      "image": FF_IMG["monthly"] },
#     { "id": 202, "name": "Monthly x5",      "price": 38.95, "skuCode": "UNGS_MONTHLYX5",      "image": FF_IMG["monthly"] },
#     { "id": 207, "name": "Monthly x10",     "price": 77.90, "skuCode": "UNGS_MONTHLYX10",     "image": FF_IMG["monthly"] },

#     # ── Level Up Pass ─────────────────────────────────────────────────────────
#     { "id": 167, "name": "Level Up (Lv.6)",  "price": 0.35, "skuCode": "UN_FF_LUP_V6",        "image": FF_IMG["uplevel"] },
#     { "id": 166, "name": "Level Up (Lv.10)", "price": 0.70, "skuCode": "UN_FF_LUP_V10",       "image": FF_IMG["uplevel"] },
#     { "id": 165, "name": "Level Up (Lv.15)", "price": 0.70, "skuCode": "UN_FFSP_LUP_V15",     "image": FF_IMG["uplevel"] },
#     { "id": 168, "name": "Level Up (Lv.20)", "price": 0.70, "skuCode": "UN_FF_LUP_V20",       "image": FF_IMG["uplevel"] },
#     { "id": 169, "name": "Level Up (Lv.25)", "price": 0.70, "skuCode": "UN_FF_LUP_V25",       "image": FF_IMG["uplevel"] },
#     { "id": 170, "name": "Level Up (Lv.30)", "price": 0.70, "skuCode": "UN_FF_LUP_V30",       "image": FF_IMG["uplevel"] },

#     # ── Evo ─────────────────────────────────────────────────────────
#     { "id": 136, "name": "EVO 3 Days",      "price": 0.60, "skuCode": "UNGS_FFEVO3DAY",      "image": FF_IMG["evo"] },
#     { "id": 137, "name": "EVO 7 Days",      "price": 1.00, "skuCode": "UNGS_FFEVO7DAY",      "image": FF_IMG["evo"] },
#     { "id": 138, "name": "EVO 30 Days",     "price": 2.50, "skuCode": "UNGS_FFEVO30DAY",     "image": FF_IMG["evo"] },
# ]


# ── Fast lookups ──────────────────────────────────────────────────────────────
MLBB_KH_BY_ID = { str(p["id"]): p for p in MLBB_KH_PACKAGES }
MLBB_PH_BY_ID = { str(p["id"]): p for p in MLBB_PH_PACKAGES }
FF_BY_ID      = { str(p["id"]): p for p in FF_PACKAGES       }


def _pool_for(game: str):
    """Return (package_list, lookup_dict) for the requested game."""
    if game == "mlbb-ph":
        return MLBB_PH_PACKAGES, MLBB_PH_BY_ID
    if game == "ff":
        return FF_PACKAGES, FF_BY_ID
    return MLBB_KH_PACKAGES, MLBB_KH_BY_ID   # default → mlbb-kh


def _game_label(game: str) -> str:
    return {"mlbb-ph": "🇵🇭 MLBB Philippines", "ff": "🔥 Free Fire", "mlbb-kh": "🇰🇭 MLBB Cambodia"}.get(game, "🗡️ Mobile Legends")

# =============================================================================
# [8] HELPERS
# =============================================================================

def send_telegram(message: str):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        requests.post(url, json={"chat_id": TELEGRAM_GROUP_ID, "text": message, "parse_mode": "HTML"}, timeout=10)
    except Exception:
        pass


def get_camrapid_balance() -> float:
    try:
        res  = requests.get(URL_USER_PROFILE, params={"api_key": CAMRAPID_API_KEY}, timeout=15)
        data = res.json()
        if data.get("status") == "SUCCESS":
            return float(data["profile"]["balance"])
    except Exception as e:
        print(f"[get_camrapid_balance] Error: {e}")
    return -1.0


def deliver_diamonds(game_id: str, zone_id: str, sku: str, order_id: str):
    """
    Direct auto-delivery for ALL games: MLBB KH, MLBB PH, and Free Fire.
    Free Fire no longer uses OTP — delivery goes through the same
    Create_Orders.php endpoint. Pass zone_id="" for Free Fire.
    """
    payload = {
        "api_key":      str(CAMRAPID_API_KEY),
        "userid":       str(game_id).strip(),
        "zoneid":       str(zone_id).strip() if zone_id else "",
        "product_code": str(sku),
        "reference":    str(order_id),
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    try:
        resp     = requests.post(URL_CREATE_ORDER, data=payload, headers=headers, timeout=30)
        res_data = resp.json()
        print(f"\n--- CAMRAPID CREATE ORDER (#{order_id}) ---")
        print(f"  userid={game_id}, zoneid={zone_id}, product={sku}")
        print(f"  Response: {res_data}")
        print("-------------------------------------------\n")
        if res_data.get("status") == "Success":
            return True, res_data.get("message", "Recharge Successful"), float(res_data.get("sale_price", 0))
        return False, res_data.get("message", "Provider error"), 0.0
    except Exception as e:
        return False, f"Request error: {str(e)}", 0.0


def fetch_raw_catalogs():
    res = requests.get(URL_PRODUCT_LIST, params={"api_key": CAMRAPID_API_KEY}, timeout=15)
    res.raise_for_status()
    return res.json()

# =============================================================================
# [9] PACKAGE API ROUTES
# =============================================================================

@app.route('/api/packages', methods=['GET'])
def get_packages():
    """
    GET /api/packages                    → MLBB KH full list (backward-compatible)
    GET /api/packages?game=mlbb-ph       → MLBB PH list
    GET /api/packages?game=ff            → Free Fire list
    GET /api/packages?game=<g>&id=<id>   → single package
    """
    game           = request.args.get("game", "mlbb-kh").lower()
    pkg_id         = request.args.get("id")
    pkg_list, pool = _pool_for(game)

    if pkg_id:
        pkg = pool.get(str(pkg_id))
        if not pkg:
            return jsonify({"status": "ERROR", "message": f"Package {pkg_id} not found for game={game}"}), 404
        return jsonify({"status": "SUCCESS", "package": pkg})

    return jsonify({"status": "SUCCESS", "game": game, "packages": pkg_list, "total": len(pkg_list)})


@app.route('/api/packages/mlbb', methods=['GET'])
@app.route('/api/packages/mlbb-kh', methods=['GET'])
def get_mlbb_kh_packages():
    pkg_id = request.args.get("id")
    if pkg_id:
        pkg = MLBB_KH_BY_ID.get(str(pkg_id))
        if not pkg:
            return jsonify({"status": "ERROR", "message": f"MLBB KH package {pkg_id} not found"}), 404
        return jsonify({"status": "SUCCESS", "package": pkg})
    return jsonify({"status": "SUCCESS", "game": "mlbb-kh", "packages": MLBB_KH_PACKAGES, "total": len(MLBB_KH_PACKAGES)})


@app.route('/api/packages/mlbb-ph', methods=['GET'])
def get_mlbb_ph_packages():
    pkg_id = request.args.get("id")
    if pkg_id:
        pkg = MLBB_PH_BY_ID.get(str(pkg_id))
        if not pkg:
            return jsonify({"status": "ERROR", "message": f"MLBB PH package {pkg_id} not found"}), 404
        return jsonify({"status": "SUCCESS", "package": pkg})
    return jsonify({"status": "SUCCESS", "game": "mlbb-ph", "packages": MLBB_PH_PACKAGES, "total": len(MLBB_PH_PACKAGES)})


@app.route('/api/packages/ff', methods=['GET'])
def get_ff_packages():
    pkg_id = request.args.get("id")
    if pkg_id:
        pkg = FF_BY_ID.get(str(pkg_id))
        if not pkg:
            return jsonify({"status": "ERROR", "message": f"FF package {pkg_id} not found"}), 404
        return jsonify({"status": "SUCCESS", "package": pkg})
    return jsonify({"status": "SUCCESS", "game": "ff", "packages": FF_PACKAGES, "total": len(FF_PACKAGES)})

# =============================================================================
# [10] CAMRAPID PROXY ROUTES
# =============================================================================

@app.route('/api/profile', methods=['GET'])
def get_profile():
    try:
        res = requests.get(URL_USER_PROFILE, params={"api_key": CAMRAPID_API_KEY}, timeout=15)
        return jsonify(res.json())
    except Exception as e:
        return jsonify({"status": "ERROR", "message": str(e)}), 500


@app.route('/api/catalogs', methods=['GET'])
def get_catalogs():
    try:
        data = fetch_raw_catalogs()
        catalogs = [{"id": c["id"], "title": c["title"], "description": c.get("description",""),
                     "img": c.get("img",""), "status": c.get("status","")}
                    for c in data.get("catalogs",[]) if c.get("status") == "ACTIVE"]
        return jsonify({"status": "SUCCESS", "catalogs": catalogs, "total": len(catalogs)})
    except Exception as e:
        return jsonify({"status": "ERROR", "message": str(e)}), 500


@app.route('/api/products', methods=['GET'])
def get_products():
    try:
        data       = fetch_raw_catalogs()
        catalog_id = request.args.get("catalog_id")
        all_products = []
        for catalog in data.get("catalogs",[]):
            if catalog.get("status") != "ACTIVE": continue
            if catalog_id and str(catalog["id"]) != str(catalog_id): continue
            for product in catalog.get("products",[]):
                if product.get("status") != "ACTIVE": continue
                all_products.append({
                    "id": product["id"], "title": product["title"],
                    "product_code": product["product_code"], "product_code_api": product["product_code_api"],
                    "sale_price": product.get("sale_price",0), "img": product.get("img",""),
                    "catalog_id": catalog["id"], "catalog_title": catalog["title"],
                })
        return jsonify({"status": "SUCCESS", "products": all_products, "total": len(all_products)})
    except Exception as e:
        return jsonify({"status": "ERROR", "message": str(e)}), 500


@app.route('/api/products/<catalog_id>', methods=['GET'])
def get_products_by_catalog(catalog_id):
    try:
        data    = fetch_raw_catalogs()
        catalog = next((c for c in data.get("catalogs",[]) if str(c["id"]) == str(catalog_id)), None)
        if not catalog:
            return jsonify({"status": "ERROR", "message": f"Catalog '{catalog_id}' not found"}), 404
        products = [
            {"id": p["id"], "title": p["title"], "product_code": p["product_code"],
             "product_code_api": p["product_code_api"], "sale_price": p.get("sale_price",0), "img": p.get("img","")}
            for p in catalog.get("products",[]) if p.get("status") == "ACTIVE"
        ]
        return jsonify({"status": "SUCCESS", "catalog_id": catalog["id"],
                        "catalog_title": catalog["title"], "products": products, "total": len(products)})
    except Exception as e:
        return jsonify({"status": "ERROR", "message": str(e)}), 500


@app.route('/api/funding-history', methods=['GET'])
def get_funding_history():
    try:
        res = requests.get(URL_FUNDING_HIST, params={"api_key": CAMRAPID_API_KEY}, timeout=15)
        return jsonify(res.json())
    except Exception as e:
        return jsonify({"status": "ERROR", "message": str(e)}), 500


@app.route('/api/orders-history', methods=['GET'])
def get_orders_history():
    try:
        res = requests.get(URL_ORDERS_HIST, params={"api_key": CAMRAPID_API_KEY}, timeout=15)
        return jsonify(res.json())
    except Exception as e:
        return jsonify({"status": "ERROR", "message": str(e)}), 500

# =============================================================================
# [11] CREATE PAYMENT  —  MLBB KH | MLBB PH | Free Fire (all auto-delivery)
# =============================================================================

@app.route('/create-payment', methods=['POST'])
def create_payment():
    """
    Body JSON: { gameId, serverId, packageId, nickname, game }
      game     = "mlbb-kh" | "mlbb-ph" | "ff"   (default: "mlbb-kh")
      serverId = zone ID for MLBB; pass "" or omit for Free Fire
    """
    try:
        data     = request.json or {}
        game_id  = data.get('gameId')
        zone_id  = data.get('serverId', '')
        pkg_id   = str(data.get('packageId', ''))
        nickname = data.get('nickname', 'N/A')
        game     = data.get('game', 'mlbb-kh').lower()

        if not game_id:
            return jsonify({"status": False, "message": "Missing required field: gameId"}), 400

        _, pool = _pool_for(game)
        if not pkg_id or pkg_id not in pool:
            return jsonify({"status": False, "message": f"Invalid packageId={pkg_id} for game={game}"}), 400

        pkg          = pool[pkg_id]
        amount       = pkg["price"]
        sku_code     = pkg["skuCode"]
        product_name = pkg["name"]
        bill_no      = f"ORD-{str(uuid.uuid4())[:8].upper()}"

        pay_data    = camrapidpay_create_payment(amount=amount, reference=bill_no)
        qr_string   = pay_data.get("qr_code", "")
        payment_url = pay_data.get("payment_url", "")
        expires_in  = pay_data.get("expires_in", "5 minutes")

        orders_col.insert_one({
            "order_id":    bill_no,
            "game":        game,
            "game_id":     str(game_id),
            "zone_id":     str(zone_id),
            "nickname":    str(nickname),
            "sku":         str(sku_code),
            "product":     str(product_name),
            "amount":      float(amount),
            "status":      "UNPAID",
            "delivered":   False,
            "sale_price":  0.0,
            "payment_url": payment_url,
            "created_at":  datetime.datetime.now(),
        })

        return jsonify({
            "status":     True,
            "qrString":   qr_string,
            "paymentUrl": payment_url,
            "orderId":    bill_no,
            "expiresIn":  expires_in,
        })

    except Exception as e:
        return jsonify({"status": False, "message": str(e)}), 500

# =============================================================================
# [12] CHECK STATUS  —  unified for MLBB KH, MLBB PH, Free Fire
#      All games now use direct auto-delivery (no OTP step for Free Fire)
# =============================================================================

@app.route('/check-status/<order_id>', methods=['GET'])
def check_status(order_id):
    order = orders_col.find_one({"order_id": order_id})
    if not order:
        return jsonify({"status": "NOT_FOUND"}), 404

    if order.get("delivered"):
        return jsonify({"status": "SUCCESS", "product": order.get("product"),
                        "game_id": order.get("game_id"), "sale_price": order.get("sale_price", 0)})

    if order.get("status") == "DELIVERY_FAILED":
        return jsonify({"status": "PAID_BUT_DELIVERY_FAILED", "error": order.get("error_msg", "Unknown error")})

    try:
        payment_status = camrapidpay_check_payment(order_id)

        if payment_status == "Success":
            print(f"\n💰 Payment verified for #{order_id}")
            game  = order.get("game", "mlbb-kh")
            label = _game_label(game)

            # ── ALL GAMES: direct auto-delivery ──────────────────────────────
            # Free Fire uses zone_id="" — same endpoint as MLBB
            success, api_msg, sale_price = deliver_diamonds(
                order['game_id'], order.get('zone_id', ''), order['sku'], order_id
            )

            if success:
                orders_col.update_one({"order_id": order_id}, {"$set": {
                    "status": "SUCCESS", "delivered": True,
                    "sale_price": sale_price, "done_at": datetime.datetime.now(),
                }})
                send_telegram(
                    f"✅ <b>ORDER SUCCESSFUL!</b>\n"
                    f"━━━━━━━━━━━━━━━━━━\n"
                    f"🎮 <b>Game:</b> {label}\n"
                    f"🆔 <b>Order ID:</b> <code>#{order_id}</code>\n"
                    f"💎 <b>Product:</b> {order['product']}\n"
                    f"👤 <b>Name:</b> {order.get('nickname','N/A')}\n"
                    f"🎮 <b>Game ID:</b> <code>{order['game_id']}</code>\n"
                    f"🌐 <b>Zone:</b> <code>{order.get('zone_id','N/A')}</code>\n"
                    f"📡 <b>Provider msg:</b> {api_msg}"
                )
                return jsonify({"status": "SUCCESS", "product": order['product'],
                                "game_id": order['game_id'], "sale_price": sale_price})
            else:
                orders_col.update_one({"order_id": order_id}, {"$set": {
                    "status": "DELIVERY_FAILED", "error_msg": api_msg,
                    "failed_at": datetime.datetime.now(),
                }})
                send_telegram(
                    f"⚠️ <b>PAYMENT OK — DELIVERY FAILED</b>\n"
                    f"━━━━━━━━━━━━━━━━━━\n"
                    f"🎮 <b>Game:</b> {label}\n"
                    f"🆔 <b>Order ID:</b> <code>#{order_id}</code>\n"
                    f"👤 <b>Name:</b> {order.get('nickname','N/A')}\n"
                    f"❌ <b>Error:</b> <code>{api_msg}</code>\n"
                    f"👉 <b>Process manually!</b>"
                )
                return jsonify({"status": "PAID_BUT_DELIVERY_FAILED", "error": api_msg})

        return jsonify({"status": payment_status.upper()})

    except Exception as e:
        return jsonify({"status": "ERROR", "message": str(e)})

# =============================================================================
# [13] WEBHOOK  —  unified for MLBB KH, MLBB PH, Free Fire
# =============================================================================

@app.route('/webhook/payment', methods=['POST'])
def payment_webhook():
    try:
        payload   = request.json or {}
        status    = payload.get("status", "").lower()
        reference = payload.get("reference", "")
        print(f"[WEBHOOK] reference={reference} status={status}")

        if status != "success" or not reference:
            return jsonify({"received": True}), 200

        order = orders_col.find_one({"order_id": reference})
        if not order:
            return jsonify({"received": True}), 200
        if order.get("delivered") or order.get("status") == "DELIVERY_FAILED":
            return jsonify({"received": True}), 200

        print(f"\n💰 [WEBHOOK] Payment confirmed for #{reference}")
        game  = order.get("game", "mlbb-kh")
        label = _game_label(game)

        # ── ALL GAMES: direct auto-delivery ──────────────────────────────────
        balance_before = get_camrapid_balance()
        if balance_before >= 0:
            print(f"   CamRapid balance: ${balance_before:.3f}")

        success, api_msg, sale_price = deliver_diamonds(
            order['game_id'], order.get('zone_id', ''), order['sku'], reference
        )

        if success:
            orders_col.update_one({"order_id": reference}, {"$set": {
                "status": "SUCCESS", "delivered": True,
                "sale_price": sale_price, "done_at": datetime.datetime.now(),
            }})
            send_telegram(
                f"✅ <b>ORDER SUCCESSFUL! (webhook)</b>\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"🎮 <b>Game:</b> {label}\n"
                f"🆔 <b>Order ID:</b> <code>#{reference}</code>\n"
                f"💎 <b>Product:</b> {order['product']}\n"
                f"📦 <b>SKU:</b> <code>{order['sku']}</code>\n"
                f"💵 <b>Charged:</b> ${order['amount']:.2f}\n"
                f"💲 <b>Cost:</b> ${sale_price:.3f}\n"
                f"🎮 <b>Game ID:</b> <code>{order['game_id']}</code>\n"
                f"🌐 <b>Zone:</b> <code>{order.get('zone_id','N/A')}</code>\n"
                f"📡 <b>Provider msg:</b> {api_msg}"
            )
        else:
            orders_col.update_one({"order_id": reference}, {"$set": {
                "status": "DELIVERY_FAILED", "error_msg": api_msg,
                "failed_at": datetime.datetime.now(),
            }})
            send_telegram(
                f"⚠️ <b>PAYMENT OK — DELIVERY FAILED (webhook)</b>\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"🎮 <b>Game:</b> {label}\n"
                f"🆔 <b>Order ID:</b> <code>#{reference}</code>\n"
                f"💎 <b>Product:</b> {order['product']}\n"
                f"❌ <b>Error:</b> <code>{api_msg}</code>\n"
                f"👉 <b>Process manually!</b>"
            )

    except Exception as e:
        print(f"[WEBHOOK] Error: {e}")

    return jsonify({"received": True}), 200

# =============================================================================
# [14] HEALTH CHECK
# =============================================================================

@app.route('/health', methods=['GET'])
def health():
    balance = get_camrapid_balance()
    return jsonify({
        "status":           "OK",
        "server":           "IRRA TOPUP",
        "merchant":         MERCHANT_NAME,
        "camrapid_balance": balance,
        "mlbb_kh_packages": len(MLBB_KH_PACKAGES),
        "mlbb_ph_packages": len(MLBB_PH_PACKAGES),
        "ff_packages":      len(FF_PACKAGES),
        "timestamp":        datetime.datetime.now().isoformat(),
    })

# =============================================================================
# [15] STATIC FILES
# =============================================================================

@app.route('/')
def serve_index():
    # Serve index.html from the frontend directory
    frontend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend')
    return send_from_directory(frontend_dir, 'index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    # Serve static files from the frontend directory
    frontend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend')
    target_path = os.path.join(frontend_dir, filename)
    
    if os.path.isdir(target_path):
        return send_from_directory(target_path, 'index.html')
    elif os.path.exists(target_path):
        return send_from_directory(frontend_dir, filename)
    
    abort(404)

# =============================================================================
# [15] ENTRY POINT
# =============================================================================

if __name__ == '__main__':
    port  = int(os.getenv("FLASK_PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    app.run(host='0.0.0.0', port=port, debug=debug)
