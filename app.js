class ChatWithMeApp {
  constructor() {
    this.currentUser = null;
    this.websocket = null;
    this.contacts = [];
    this.currentPrivateChatUser = null;
    this.selectedActivity = null;
    this.invitationTargetUser = null;
    this.currentInvitation = null;
    
    this.init();
  }

  async init() {
    // Check if user is already logged in
    const savedUser = localStorage.getItem('chatwithme_user');
    if (savedUser) {
      this.currentUser = JSON.parse(savedUser);
      this.showMainInterface();
    } else {
      this.showLoginModal();
    }
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Login form
    const loginForm = document.getElementById('login-form');
    loginForm.addEventListener('submit', this.handleLogin.bind(this));

    // Message sending
    document.getElementById('chatwithme-send').addEventListener('click', () => {
      this.sendPublicMessage('chatwithme');
    });
    document.getElementById('towhomilovethemost-send').addEventListener('click', () => {
      this.sendPublicMessage('towhomilovethemost');
    });

    // Enter key for sending messages
    document.getElementById('chatwithme-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendPublicMessage('chatwithme');
    });
    document.getElementById('towhomilovethemost-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendPublicMessage('towhomilovethemost');
    });

    // Activity item clicks
    document.querySelectorAll('.activity-item').forEach(item => {
      item.addEventListener('click', this.handleActivityClick.bind(this));
    });

    // Modal event listeners
    this.setupModalEventListeners();
  }

  setupModalEventListeners() {
    // Private chat modal
    document.getElementById('close-private-chat').addEventListener('click', this.closePrivateChat.bind(this));
    document.getElementById('send-private-message').addEventListener('click', this.sendPrivateMessage.bind(this));
    document.getElementById('private-message-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendPrivateMessage();
    });

    // Activity invitation responses
    document.getElementById('accept-invitation').addEventListener('click', () => {
      this.respondToInvitation(true);
    });
    document.getElementById('decline-invitation').addEventListener('click', () => {
      this.respondToInvitation(false);
    });

    // Activity selection modal
    document.getElementById('send-activity-invitation').addEventListener('click', this.sendActivityInvitation.bind(this));
    document.getElementById('cancel-activity-invitation').addEventListener('click', this.closeActivitySelectionModal.bind(this));
    
    document.querySelectorAll('.activity-invite-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.activity-invite-btn').forEach(b => b.classList.remove('selected'));
        e.target.classList.add('selected');
        this.selectedActivity = e.target.dataset.activity;
      });
    });
  }

  async handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    
    if (!username) return;

    try {
      const formData = new FormData();
      formData.append('username', username);

      const response = await fetch('/users/create', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      
      if (response.ok) {
        this.currentUser = result.user;
        localStorage.setItem('chatwithme_user', JSON.stringify(this.currentUser));
        this.showMainInterface();
      } else {
        // Extract error message properly
        const errorMessage = result.detail || result.message || 'Unknown error occurred';
        alert('Failed to create user: ' + errorMessage);
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('Failed to connect to server');
    }
  }

  showLoginModal() {
    document.getElementById('login-modal').classList.remove('hidden');
    document.getElementById('main-interface').classList.add('hidden');
  }

  async showMainInterface() {
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('main-interface').classList.remove('hidden');
    
    // Update user info in header
    document.getElementById('current-user-avatar').src = this.currentUser.avatar_url;
    document.getElementById('current-user-name').textContent = this.currentUser.username;
    document.getElementById('current-chat-side').textContent = this.currentUser.chat_side;
    document.getElementById('current-chat-side').className = `chat-side-badge ${this.currentUser.chat_side}`;

    // Initialize WebSocket connection
    this.connectWebSocket();
    
    // Load initial data
    await this.loadContacts();
    await this.loadPublicMessages();
    
    // Show the appropriate chat window based on user's assignment
    this.updateChatWindowVisibility();
  }

  updateChatWindowVisibility() {
    const chatwithmeWindow = document.getElementById('chatwithme-window');
    const towhomWindow = document.getElementById('towhomilovethemost-window');
    
    if (this.currentUser.chat_side === 'chatwithme') {
      chatwithmeWindow.classList.add('active');
      towhomWindow.classList.remove('active');
    } else {
      chatwithmeWindow.classList.remove('active');
      towhomWindow.classList.add('active');
    }
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${this.currentUser.id}`;
    
    this.websocket = new WebSocket(wsUrl);
    
    this.websocket.onopen = () => {
      console.log('WebSocket connected');
    };
    
    this.websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleWebSocketMessage(data);
    };
    
    this.websocket.onclose = () => {
      console.log('WebSocket disconnected, attempting to reconnect...');
      setTimeout(() => this.connectWebSocket(), 3000);
    };
    
    this.websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  handleWebSocketMessage(data) {
    switch (data.type) {
      case 'new_message':
        this.handleNewMessage(data.message);
        break;
      case 'activity_invitation':
        this.handleActivityInvitation(data.invitation);
        break;
      case 'invitation_response':
        this.handleInvitationResponse(data.response);
        break;
    }
  }

  handleNewMessage(message) {
    if (message.is_public) {
      this.addMessageToChat(message, 'public');
    } else {
      this.addMessageToChat(message, 'private');
    }
  }

  async sendPublicMessage(chatSide) {
    const inputId = `${chatSide}-input`;
    const input = document.getElementById(inputId);
    const message = input.value.trim();
    
    if (!message) return;

    try {
      const response = await fetch('/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `sender_id=${this.currentUser.id}&content=${encodeURIComponent(message)}&is_public=true`
      });

      if (response.ok) {
        input.value = '';
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  async sendPrivateMessage() {
    const input = document.getElementById('private-message-input');
    const message = input.value.trim();
    
    if (!message || !this.currentPrivateChatUser) return;

    try {
      const response = await fetch('/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `sender_id=${this.currentUser.id}&content=${encodeURIComponent(message)}&recipient_id=${this.currentPrivateChatUser.id}&is_public=false`
      });

      if (response.ok) {
        input.value = '';
      }
    } catch (error) {
      console.error('Error sending private message:', error);
    }
  }

  async loadContacts() {
    try {
      const response = await fetch(`/users/${this.currentUser.id}/contacts`);
      const contacts = await response.json();
      
      this.contacts = contacts;
      this.renderContacts();
    } catch (error) {
      console.error('Error loading contacts:', error);
    }
  }

  renderContacts() {
    const chatwithmeContainer = document.getElementById('chatwithme-contacts');
    const towhomContainer = document.getElementById('towhomilovethemost-contacts');
    
    // Clear existing contacts
    chatwithmeContainer.innerHTML = '';
    towhomContainer.innerHTML = '';
    
    this.contacts.forEach(contact => {
      const contactBubble = this.createContactBubble(contact);
      
      // Add to both chat windows
      chatwithmeContainer.appendChild(contactBubble.cloneNode(true));
      towhomContainer.appendChild(contactBubble);
    });
    
    // Add event listeners to contact bubbles
    document.querySelectorAll('.contact-bubble').forEach(bubble => {
      bubble.addEventListener('click', this.handleContactClick.bind(this));
    });
    
    // Add event listeners to avatar clicks
    document.querySelectorAll('.contact-avatar').forEach(avatar => {
      avatar.addEventListener('click', this.handleAvatarClick.bind(this));
    });
  }

  createContactBubble(contact) {
    const bubble = document.createElement('div');
    bubble.className = 'contact-bubble';
    bubble.dataset.userId = contact.user.id;
    
    bubble.innerHTML = `
      <img src="${contact.user.avatar_url}" alt="${contact.user.username}" class="contact-avatar" data-user-id="${contact.user.id}">
      <div class="contact-info">
        <div class="contact-name">${contact.user.username}</div>
        <div class="contact-summary">${contact.summary}</div>
        <div class="contact-side-badge ${contact.user.chat_side}">${contact.user.chat_side}</div>
      </div>
    `;
    
    return bubble;
  }

  handleContactClick(e) {
    if (e.target.classList.contains('contact-avatar')) return; // Let avatar handler deal with this
    
    const userId = e.currentTarget.dataset.userId;
    const contact = this.contacts.find(c => c.user.id === userId);
    
    if (contact) {
      this.openPrivateChat(contact.user);
    }
  }

  handleAvatarClick(e) {
    e.stopPropagation();
    const userId = e.target.dataset.userId;
    const contact = this.contacts.find(c => c.user.id === userId);
    
    if (contact) {
      this.openActivitySelectionModal(contact.user);
    }
  }

  handleActivityClick(e) {
    const activity = e.currentTarget.dataset.activity;
    // For now, just highlight the selected activity
    document.querySelectorAll('.activity-item').forEach(item => {
      item.classList.remove('selected');
    });
    e.currentTarget.classList.add('selected');
    
    // Could expand this to show activity-specific features
    console.log(`Selected activity: ${activity}`);
  }

  openPrivateChat(user) {
    this.currentPrivateChatUser = user;
    document.getElementById('private-chat-title').textContent = `Chat with ${user.username}`;
    document.getElementById('private-chat-modal').classList.remove('hidden');
    
    // Load private messages for this user
    this.loadPrivateMessages(user.id);
  }

  closePrivateChat() {
    document.getElementById('private-chat-modal').classList.add('hidden');
    this.currentPrivateChatUser = null;
  }

  openActivitySelectionModal(user) {
    this.invitationTargetUser = user;
    document.getElementById('invite-target-user').textContent = user.username;
    document.getElementById('activity-selection-modal').classList.remove('hidden');
    
    // Reset selection
    document.querySelectorAll('.activity-invite-btn').forEach(btn => {
      btn.classList.remove('selected');
    });
    this.selectedActivity = null;
  }

  closeActivitySelectionModal() {
    document.getElementById('activity-selection-modal').classList.add('hidden');
    this.invitationTargetUser = null;
    this.selectedActivity = null;
  }

  async sendActivityInvitation() {
    if (!this.selectedActivity || !this.invitationTargetUser) {
      alert('Please select an activity');
      return;
    }

    const message = document.getElementById('invitation-message-input').value.trim();

    try {
      const response = await fetch('/activities/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `from_user_id=${this.currentUser.id}&to_user_id=${this.invitationTargetUser.id}&activity_name=${this.selectedActivity}&message=${encodeURIComponent(message)}`
      });

      if (response.ok) {
        alert('Invitation sent!');
        this.closeActivitySelectionModal();
        document.getElementById('invitation-message-input').value = '';
      } else {
        const error = await response.json();
        alert('Failed to send invitation: ' + error.detail);
      }
    } catch (error) {
      console.error('Error sending invitation:', error);
      alert('Failed to send invitation');
    }
  }

  handleActivityInvitation(invitation) {
    this.currentInvitation = invitation;
    const content = document.getElementById('invitation-content');
    
    content.innerHTML = `
      <div class="invitation-details">
        <img src="${invitation.from_user.avatar_url}" alt="${invitation.from_user.username}" class="invitation-avatar">
        <p><strong>${invitation.from_user.username}</strong> invited you to join <strong>${invitation.activity}</strong></p>
        ${invitation.message ? `<p class="invitation-message">"${invitation.message}"</p>` : ''}
      </div>
    `;
    
    document.getElementById('invitation-modal').classList.remove('hidden');
  }

  async respondToInvitation(accept) {
    if (!this.currentInvitation) return;

    try {
      const response = await fetch(`/activities/invitations/${this.currentInvitation.id}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `user_id=${this.currentUser.id}&accept=${accept}`
      });

      if (response.ok) {
        document.getElementById('invitation-modal').classList.add('hidden');
        this.currentInvitation = null;
      }
    } catch (error) {
      console.error('Error responding to invitation:', error);
    }
  }

  handleInvitationResponse(response) {
    const message = response.accepted ? 
      `${response.responder.username} accepted your ${response.activity} invitation!` :
      `${response.responder.username} declined your ${response.activity} invitation.`;
    
    // Show notification
    this.showNotification(message);
  }

  showNotification(message) {
    // Create a simple notification
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 5000);
  }

  async loadPublicMessages() {
    try {
      const response = await fetch('/messages/public');
      const messages = await response.json();
      
      messages.forEach(message => {
        this.addMessageToChat(message, 'public');
      });
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  }

  async loadPrivateMessages(userId) {
    // This would need to be implemented in the backend
    // For now, just clear the private messages container
    document.getElementById('private-messages').innerHTML = '<p>Private chat history would appear here...</p>';
  }

  addMessageToChat(message, type) {
    const isFromCurrentUser = message.sender.id === this.currentUser.id;
    
    if (type === 'public') {
      const chatwithmeContainer = document.getElementById('chatwithme-messages');
      const towhomContainer = document.getElementById('towhomilovethemost-messages');
      
      const messageElement = this.createMessageElement(message, isFromCurrentUser);
      
      chatwithmeContainer.appendChild(messageElement.cloneNode(true));
      towhomContainer.appendChild(messageElement);
      
      // Scroll to bottom
      chatwithmeContainer.scrollTop = chatwithmeContainer.scrollHeight;
      towhomContainer.scrollTop = towhomContainer.scrollHeight;
    } else {
      // Private message
      const container = document.getElementById('private-messages');
      const messageElement = this.createMessageElement(message, isFromCurrentUser);
      container.appendChild(messageElement);
      container.scrollTop = container.scrollHeight;
    }
  }

  createMessageElement(message, isFromCurrentUser) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isFromCurrentUser ? 'sent' : 'received'}`;
    
    const time = new Date(message.timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    messageDiv.innerHTML = `
      <img src="${message.sender.avatar_url}" alt="${message.sender.username}" class="message-avatar">
      <div class="message-content">
        <div class="message-header">
          <span class="message-sender">${message.sender.username}</span>
          <span class="message-time">${time}</span>
        </div>
        <div class="message-text">${message.content}</div>
      </div>
    `;
    
    return messageDiv;
  }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new ChatWithMeApp();
});
