"""
ChatWithMe - A dual-chat system with activity-based interactions

A sophisticated chat application that connects users through two mirrored chat windows
(ChatWithMe and ToWhomILoveTheMost) with activity invitation capabilities.
"""

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Dict, List, Optional
import json
import uuid
import asyncio
from datetime import datetime
import os
from pathlib import Path

app = FastAPI(title="ChatWithMe API",
              description="Dual-chat system with activity-based interactions")

# Mount the static files directory
current_dir = Path(__file__).parent
app.mount("/static", StaticFiles(directory=current_dir), name="static")

# Data models
class User(BaseModel):
    id: str
    username: str
    avatar_url: str
    chat_side: str  # "chatwithme" or "towhomilovethemost"
    is_active: bool = True

class Message(BaseModel):
    id: str
    sender_id: str
    recipient_id: Optional[str] = None
    content: str
    timestamp: datetime
    is_public: bool = True
    chat_room: str = "playground"

class ActivityInvitation(BaseModel):
    id: str
    from_user_id: str
    to_user_id: str
    activity_name: str
    message: str
    status: str = "pending"  # pending, accepted, declined
    timestamp: datetime

class ChatSummary(BaseModel):
    user_id: str
    other_user_id: str
    summary: str
    last_updated: datetime

# In-memory data storage
users: Dict[str, User] = {}
messages: List[Message] = []
activity_invitations: List[ActivityInvitation] = []
chat_summaries: Dict[str, ChatSummary] = {}
active_connections: Dict[str, WebSocket] = {}

# Available activities
ACTIVITIES = ["Chess", "Math", "Science", "Programming", "Skills"]

# Connection manager for WebSocket
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket

    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]

    async def send_personal_message(self, message: str, user_id: str):
        if user_id in self.active_connections:
            await self.active_connections[user_id].send_text(message)

    async def broadcast_to_room(self, message: str, room: str = "playground"):
        for user_id, connection in self.active_connections.items():
            try:
                await connection.send_text(message)
            except:
                # Connection is broken, remove it
                del self.active_connections[user_id]

manager = ConnectionManager()

@app.get("/")
def root():
    return RedirectResponse(url="/static/index.html")

@app.post("/users/create")
async def create_user(username: str = Form(...), avatar_url: str = Form(None)):
    """Create a new user and assign them to a chat side"""
    user_id = str(uuid.uuid4())
    
    # Assign users alternately to each chat side
    chat_sides = ["chatwithme", "towhomilovethemost"]
    assigned_side = chat_sides[len(users) % 2]
    
    if not avatar_url:
        avatar_url = f"https://ui-avatars.com/api/?name={username}&background=random"
    
    user = User(
        id=user_id,
        username=username,
        avatar_url=avatar_url,
        chat_side=assigned_side
    )
    
    users[user_id] = user
    return {"user": user, "message": f"User created and assigned to {assigned_side}"}

@app.get("/users/{user_id}")
async def get_user(user_id: str):
    if user_id not in users:
        raise HTTPException(status_code=404, detail="User not found")
    return users[user_id]

@app.get("/users")
async def get_all_users():
    return list(users.values())

@app.get("/users/{user_id}/contacts")
async def get_user_contacts(user_id: str):
    """Get contacts with chat summaries for a user"""
    if user_id not in users:
        raise HTTPException(status_code=404, detail="User not found")
    
    contacts = []
    for other_user_id, other_user in users.items():
        if other_user_id != user_id:
            # Generate summary key
            summary_key = f"{min(user_id, other_user_id)}_{max(user_id, other_user_id)}"
            summary = chat_summaries.get(summary_key)
            
            contact = {
                "user": other_user,
                "summary": summary.summary if summary else "No conversation yet",
                "last_interaction": summary.last_updated if summary else None
            }
            contacts.append(contact)
    
    return contacts

@app.post("/messages/send")
async def send_message(sender_id: str, content: str, recipient_id: str = None, is_public: bool = True):
    """Send a message in public chat or private chat"""
    if sender_id not in users:
        raise HTTPException(status_code=404, detail="Sender not found")
    
    if recipient_id and recipient_id not in users:
        raise HTTPException(status_code=404, detail="Recipient not found")
    
    message = Message(
        id=str(uuid.uuid4()),
        sender_id=sender_id,
        recipient_id=recipient_id,
        content=content,
        timestamp=datetime.now(),
        is_public=is_public,
        chat_room="playground" if is_public else "private"
    )
    
    messages.append(message)
    
    # Update chat summary for private messages
    if not is_public and recipient_id:
        await update_chat_summary(sender_id, recipient_id, content)
    
    # Broadcast message via WebSocket
    message_data = {
        "type": "new_message",
        "message": {
            "id": message.id,
            "sender": users[sender_id].dict(),
            "recipient": users[recipient_id].dict() if recipient_id else None,
            "content": content,
            "timestamp": message.timestamp.isoformat(),
            "is_public": is_public
        }
    }
    
    if is_public:
        await manager.broadcast_to_room(json.dumps(message_data))
    else:
        # Send to both sender and recipient
        await manager.send_personal_message(json.dumps(message_data), sender_id)
        if recipient_id:
            await manager.send_personal_message(json.dumps(message_data), recipient_id)
    
    return {"message": "Message sent successfully", "message_id": message.id}

async def update_chat_summary(user1_id: str, user2_id: str, latest_message: str):
    """Update or create chat summary between two users"""
    summary_key = f"{min(user1_id, user2_id)}_{max(user1_id, user2_id)}"
    
    # Simple semantic summary generation (in real app, you'd use AI)
    summaries = [
        "You seem to be getting along well",
        "You had a friendly conversation",
        "You discussed shared interests",
        "You argued about something",
        "You made plans together",
        "You shared personal stories",
        "You helped each other out"
    ]
    
    import random
    new_summary = random.choice(summaries)
    
    chat_summaries[summary_key] = ChatSummary(
        user_id=user1_id,
        other_user_id=user2_id,
        summary=new_summary,
        last_updated=datetime.now()
    )

@app.get("/messages/public")
async def get_public_messages(limit: int = 50):
    """Get recent public messages for the playground"""
    public_msgs = [msg for msg in messages if msg.is_public]
    recent_msgs = sorted(public_msgs, key=lambda x: x.timestamp, reverse=True)[:limit]
    
    # Add user information to messages
    enriched_messages = []
    for msg in reversed(recent_msgs):  # Show oldest first
        enriched_msg = {
            "id": msg.id,
            "sender": users[msg.sender_id].dict(),
            "content": msg.content,
            "timestamp": msg.timestamp.isoformat(),
            "is_public": msg.is_public
        }
        enriched_messages.append(enriched_msg)
    
    return enriched_messages

@app.post("/activities/invite")
async def send_activity_invitation(from_user_id: str, to_user_id: str, activity_name: str, message: str = ""):
    """Send an activity invitation to another user"""
    if from_user_id not in users:
        raise HTTPException(status_code=404, detail="Sender not found")
    
    if to_user_id not in users:
        raise HTTPException(status_code=404, detail="Recipient not found")
    
    if activity_name not in ACTIVITIES:
        raise HTTPException(status_code=400, detail="Invalid activity")
    
    # Check if recipient is on the opposite chat side
    sender = users[from_user_id]
    recipient = users[to_user_id]
    
    if sender.chat_side == recipient.chat_side:
        raise HTTPException(status_code=400, detail="Can only invite users from the opposite chat")
    
    invitation = ActivityInvitation(
        id=str(uuid.uuid4()),
        from_user_id=from_user_id,
        to_user_id=to_user_id,
        activity_name=activity_name,
        message=message,
        timestamp=datetime.now()
    )
    
    activity_invitations.append(invitation)
    
    # Notify recipient via WebSocket
    invitation_data = {
        "type": "activity_invitation",
        "invitation": {
            "id": invitation.id,
            "from_user": sender.dict(),
            "activity": activity_name,
            "message": message,
            "timestamp": invitation.timestamp.isoformat()
        }
    }
    
    await manager.send_personal_message(json.dumps(invitation_data), to_user_id)
    
    return {"message": "Activity invitation sent", "invitation_id": invitation.id}

@app.post("/activities/invitations/{invitation_id}/respond")
async def respond_to_invitation(invitation_id: str, user_id: str, accept: bool):
    """Accept or decline an activity invitation"""
    invitation = next((inv for inv in activity_invitations if inv.id == invitation_id), None)
    
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")
    
    if invitation.to_user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to respond to this invitation")
    
    invitation.status = "accepted" if accept else "declined"
    
    # Notify sender
    response_data = {
        "type": "invitation_response",
        "response": {
            "invitation_id": invitation_id,
            "activity": invitation.activity_name,
            "accepted": accept,
            "responder": users[user_id].dict()
        }
    }
    
    await manager.send_personal_message(json.dumps(response_data), invitation.from_user_id)
    
    return {"message": f"Invitation {'accepted' if accept else 'declined'}"}

@app.get("/activities")
async def get_activities():
    """Get list of available activities"""
    return {"activities": ACTIVITIES}

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    if user_id not in users:
        await websocket.close(code=4004)
        return
    
    await manager.connect(websocket, user_id)
    try:
        while True:
            # Keep connection alive and handle incoming messages
            data = await websocket.receive_text()
            # Echo back for now (you can add more sophisticated handling)
            await websocket.send_text(f"Message received: {data}")
    except WebSocketDisconnect:
        manager.disconnect(user_id)
        # Update user as inactive
        if user_id in users:
            users[user_id].is_active = False
