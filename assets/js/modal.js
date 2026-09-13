export function showModal(title, contentHtml, actions = []) {
 const container = document.getElementById('modal-container');
 if (!container) return;
 
 const modalOverlay = document.createElement('div');
 modalOverlay.className = 'modal-overlay';
 
 const modalContent = document.createElement('div');
 modalContent.className = 'modal-content';
 
 modalContent.innerHTML = `
        <div class="modal-header">
            <h3>${title}</h3>
            <button class="modal-close-btn">&times;</button>
        </div>
        <div class="modal-body">${contentHtml}</div>
        <div class="modal-footer"></div>
    `;
 
 const footer = modalContent.querySelector('.modal-footer');
 
 actions.forEach(action => {
  const btn = document.createElement('button');
  btn.className = `btn ${action.class || 'btn-secondary'}`;
  btn.innerText = action.label;
  btn.addEventListener('click', () => {
   if (action.onClick) action.onClick(modalContent);
  });
  footer.appendChild(btn);
 });
 
 modalOverlay.appendChild(modalContent);
 container.appendChild(modalOverlay);
 
 // Show modal with animation
 setTimeout(() => modalOverlay.classList.add('active'), 10);
 
 // Close handlers
 const closeModal = () => {
  modalOverlay.classList.remove('active');
  setTimeout(() => modalOverlay.remove(), 300);
 };
 
 modalContent.querySelector('.modal-close-btn').addEventListener('click', closeModal);
 modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
 });
 
 return { modalContent, closeModal };
}