import { writable } from 'svelte/store';
import { toast } from 'svelte-sonner';

// Toast notification store
function createToastStore() {
  const { subscribe, set, update } = writable([]);

  // Show success toast
  function success(message, options = {}) {
    toast.success(message, {
      position: 'top-right',
      duration: 4000,
      ...options
    });
  }

  // Show error toast
  function error(message, options = {}) {
    toast.error(message, {
      position: 'top-right',
      duration: 6000,
      ...options
    });
  }

  // Show info toast
  function info(message, options = {}) {
    toast.info(message, {
      position: 'top-right',
      duration: 4000,
      ...options
    });
  }

  // Show warning toast
  function warning(message, options = {}) {
    toast.warning(message, {
      position: 'top-right',
      duration: 5000,
      ...options
    });
  }

  // Show loading toast
  function loading(message, options = {}) {
    return toast.loading(message, {
      position: 'top-right',
      duration: 0, // Loading toasts don't auto-dismiss
      ...options
    });
  }

  // Dismiss toast by ID
  function dismiss(id) {
    toast.dismiss(id);
  }

  // Dismiss all toasts
  function dismissAll() {
    toast.dismiss();
  }

  // Promise toast - shows loading, then success/error based on promise result
  function promise(promise, options = {}) {
    const { 
      loading: loadingMessage = 'Cargando...', 
      success: successMessage, 
      error: errorMessage 
    } = options;

    return toast.promise(promise, {
      loading: loadingMessage,
      success: successMessage || 'Operación completada exitosamente',
      error: errorMessage || 'Error en la operación',
      position: 'top-right',
      duration: 4000
    });
  }

  // Custom toast with action buttons
  function custom(message, options = {}) {
    const { action, onAction, duration = 6000 } = options;
    
    return toast(message, {
      action: {
        label: action,
        onClick: onAction
      },
      duration,
      position: 'top-right'
    });
  }

  return {
    subscribe,
    success,
    error,
    info,
    warning,
    loading,
    dismiss,
    dismissAll,
    promise,
    custom
  };
}

export const toastStore = createToastStore();

// Export individual functions for convenience
export const {
  success,
  error,
  info,
  warning,
  loading,
  dismiss,
  dismissAll,
  promise: promiseToast,
  custom
} = toastStore;
