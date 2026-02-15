# Quick Trade endpoints: sell/buy points and properties
from datetime import datetime
from pydantic import BaseModel
from fastapi import Depends, HTTPException
from bson import ObjectId

from server import db, get_current_user

# Pydantic models
class CreateSellOffer(BaseModel):
    points: int
    cost: int
    hide_name: bool = False

class CreateBuyOffer(BaseModel):
    points: int
    offer: int
    hide_name: bool = False

# Helper function to serialize MongoDB documents
def serialize_offer(offer):
    if not offer:
        return None
    offer["id"] = str(offer.pop("_id"))
    return offer

# GET all sell offers
async def get_sell_offers():
    """Get all active sell point offers"""
    try:
        # Get from database
        offers = list(await db.trade_sell_offers.find({"status": "active"}).sort("created_at", -1).to_list(length=100))
        
        # Serialize
        result = []
        for offer in offers:
            result.append({
                "id": str(offer["_id"]),
                "username": offer.get("username", "Anonymous") if not offer.get("hide_name") else "[Anonymous]",
                "user_id": str(offer["user_id"]),
                "points": offer["points"],
                "money": offer["cost"],
                "hide_name": offer.get("hide_name", False),
                "created_at": offer.get("created_at")
            })
        
        return result
    except Exception as e:
        print(f"Error fetching sell offers: {e}")
        return []

# GET all buy offers
async def get_buy_offers():
    """Get all active buy point offers"""
    try:
        # Get from database
        offers = list(await db.trade_buy_offers.find({"status": "active"}).sort("created_at", -1).to_list(length=100))
        
        # Serialize
        result = []
        for offer in offers:
            result.append({
                "id": str(offer["_id"]),
                "username": offer.get("username", "Anonymous") if not offer.get("hide_name") else "[Anonymous]",
                "user_id": str(offer["user_id"]),
                "points": offer["points"],
                "cost": offer["offer"],
                "hide_name": offer.get("hide_name", False),
                "created_at": offer.get("created_at")
            })
        
        return result
    except Exception as e:
        print(f"Error fetching buy offers: {e}")
        return []

# POST create sell offer
async def create_sell_offer(offer: CreateSellOffer, current_user: dict = Depends(get_current_user)):
    """Create a new sell point offer"""
    try:
        user_id = current_user["id"]
        username = current_user.get("username", "Unknown")
        
        # Validate amounts
        if offer.points <= 0 or offer.cost <= 0:
            raise HTTPException(status_code=400, detail="Points and cost must be positive")
        
        # Check user has enough points
        user = await db.users.find_one({"id": user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        if user.get("points", 0) < offer.points:
            raise HTTPException(status_code=400, detail="Insufficient points")
        
        # Deduct points from user
        await db.users.update_one(
            {"id": user_id},
            {"$inc": {"points": -offer.points}}
        )
        
        # Create offer
        new_offer = {
            "user_id": user_id,
            "username": username,
            "points": offer.points,
            "cost": offer.cost,
            "hide_name": offer.hide_name,
            "status": "active",
            "created_at": datetime.utcnow()
        }
        
        result = await db.trade_sell_offers.insert_one(new_offer)
        
        return {
            "message": "Sell offer created successfully",
            "offer_id": str(result.inserted_id)
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error creating sell offer: {e}")
        raise HTTPException(status_code=500, detail="Failed to create sell offer")

# POST create buy offer
async def create_buy_offer(offer: CreateBuyOffer, current_user: dict = Depends(get_current_user)):
    """Create a new buy point offer"""
    try:
        user_id = current_user["id"]
        username = current_user.get("username", "Unknown")
        
        # Validate amounts
        if offer.points <= 0 or offer.offer <= 0:
            raise HTTPException(status_code=400, detail="Points and offer must be positive")
        
        # Check user has enough money
        user = await db.users.find_one({"id": user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        if user.get("cash", 0) < offer.offer:
            raise HTTPException(status_code=400, detail="Insufficient cash")
        
        # Deduct cash from user
        await db.users.update_one(
            {"id": user_id},
            {"$inc": {"cash": -offer.offer}}
        )
        
        # Create offer
        new_offer = {
            "user_id": user_id,
            "username": username,
            "points": offer.points,
            "offer": offer.offer,
            "hide_name": offer.hide_name,
            "status": "active",
            "created_at": datetime.utcnow()
        }
        
        result = await db.trade_buy_offers.insert_one(new_offer)
        
        return {
            "message": "Buy offer created successfully",
            "offer_id": str(result.inserted_id)
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error creating buy offer: {e}")
        raise HTTPException(status_code=500, detail="Failed to create buy offer")

# POST accept sell offer
async def accept_sell_offer(offer_id: str, current_user: dict = Depends(get_current_user)):
    """Accept a sell point offer (buy points from someone)"""
    try:
        buyer_id = current_user["id"]
        
        # Get offer
        offer = await db.trade_sell_offers.find_one({
            "_id": ObjectId(offer_id),
            "status": "active"
        })
        
        if not offer:
            raise HTTPException(status_code=404, detail="Offer not found or already completed")
        
        # Can't accept own offer
        if offer["user_id"] == buyer_id:
            raise HTTPException(status_code=400, detail="Cannot accept your own offer")
        
        # Get buyer
        buyer = await db.users.find_one({"id": buyer_id})
        if not buyer:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Check buyer has enough cash
        if buyer.get("cash", 0) < offer["cost"]:
            raise HTTPException(status_code=400, detail="Insufficient cash")
        
        # Process transaction
        # Buyer: -cash, +points
        await db.users.update_one(
            {"id": buyer_id},
            {
                "$inc": {
                    "cash": -offer["cost"],
                    "points": offer["points"]
                }
            }
        )
        
        # Seller: +cash
        await db.users.update_one(
            {"id": offer["user_id"]},
            {"$inc": {"cash": offer["cost"]}}
        )
        
        # Mark offer as completed
        await db.trade_sell_offers.update_one(
            {"_id": ObjectId(offer_id)},
            {
                "$set": {
                    "status": "completed",
                    "buyer_id": buyer_id,
                    "completed_at": datetime.utcnow()
                }
            }
        )
        
        return {
            "message": "Trade completed successfully",
            "points_received": offer["points"],
            "cost_paid": offer["cost"]
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error accepting sell offer: {e}")
        raise HTTPException(status_code=500, detail="Failed to complete trade")

# POST accept buy offer
async def accept_buy_offer(offer_id: str, current_user: dict = Depends(get_current_user)):
    """Accept a buy point offer (sell points to someone)"""
    try:
        seller_id = current_user["id"]
        
        # Get offer
        offer = await db.trade_buy_offers.find_one({
            "_id": ObjectId(offer_id),
            "status": "active"
        })
        
        if not offer:
            raise HTTPException(status_code=404, detail="Offer not found or already completed")
        
        # Can't accept own offer
        if offer["user_id"] == seller_id:
            raise HTTPException(status_code=400, detail="Cannot accept your own offer")
        
        # Get seller
        seller = await db.users.find_one({"id": seller_id})
        if not seller:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Check seller has enough points
        if seller.get("points", 0) < offer["points"]:
            raise HTTPException(status_code=400, detail="Insufficient points")
        
        # Process transaction
        # Seller: -points, +cash
        await db.users.update_one(
            {"id": seller_id},
            {
                "$inc": {
                    "points": -offer["points"],
                    "cash": offer["offer"]
                }
            }
        )
        
        # Buyer: +points
        await db.users.update_one(
            {"id": offer["user_id"]},
            {"$inc": {"points": offer["points"]}}
        )
        
        # Mark offer as completed
        await db.trade_buy_offers.update_one(
            {"_id": ObjectId(offer_id)},
            {
                "$set": {
                    "status": "completed",
                    "seller_id": seller_id,
                    "completed_at": datetime.utcnow()
                }
            }
        )
        
        return {
            "message": "Trade completed successfully",
            "points_sold": offer["points"],
            "cash_received": offer["offer"]
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error accepting buy offer: {e}")
        raise HTTPException(status_code=500, detail="Failed to complete trade")

# GET properties for sale
async def get_properties_for_sale(current_user: dict = Depends(get_current_user)):
    """Get all properties listed for sale"""
    try:
        # Get properties with for_sale flag
        properties = list(await db.properties.find({"for_sale": True}).sort("created_at", -1).to_list(length=100))
        
        # Serialize
        result = []
        for prop in properties:
            result.append({
                "id": str(prop["_id"]),
                "location": prop.get("location", "Unknown"),
                "property_name": prop.get("name", "Property"),
                "owner": prop.get("owner_username", "Unknown"),
                "owner_id": str(prop.get("owner_id", "")),
                "points": prop.get("sale_price", 0),
                "created_at": prop.get("created_at")
            })
        
        return result
    except Exception as e:
        print(f"Error fetching properties: {e}")
        return []

# POST buy property
async def buy_property(property_id: str, current_user: dict = Depends(get_current_user)):
    """Buy a property listed for sale"""
    try:
        buyer_id = current_user["id"]
        buyer_username = current_user.get("username", "Unknown")
        
        # Get property
        prop = await db.properties.find_one({
            "_id": ObjectId(property_id),
            "for_sale": True
        })
        
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found or not for sale")
        
        # Can't buy own property
        if str(prop.get("owner_id")) == buyer_id:
            raise HTTPException(status_code=400, detail="Cannot buy your own property")
        
        # Get buyer
        buyer = await db.users.find_one({"id": buyer_id})
        if not buyer:
            raise HTTPException(status_code=404, detail="User not found")
        
        sale_price = prop.get("sale_price", 0)
        
        # Check buyer has enough points
        if buyer.get("points", 0) < sale_price:
            raise HTTPException(status_code=400, detail="Insufficient points")
        
        # Process transaction
        # Buyer: -points, become owner
        await db.users.update_one(
            {"id": buyer_id},
            {"$inc": {"points": -sale_price}}
        )
        
        # Seller: +points
        if prop.get("owner_id"):
            await db.users.update_one(
                {"id": prop["owner_id"]},
                {"$inc": {"points": sale_price}}
            )
        
        # Update property ownership
        await db.properties.update_one(
            {"_id": ObjectId(property_id)},
            {
                "$set": {
                    "owner_id": buyer_id,
                    "owner_username": buyer_username,
                    "for_sale": False,
                    "sale_price": 0,
                    "purchased_at": datetime.utcnow()
                }
            }
        )
        
        return {
            "message": "Property purchased successfully",
            "property_name": prop.get("name", "Property"),
            "points_spent": sale_price
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error buying property: {e}")
        raise HTTPException(status_code=500, detail="Failed to purchase property")
