export const sendResponse = (res, statusCode, message, data = null) => {
  const response = {
    success: statusCode >= 200 && statusCode < 300,
    message,
  };
  
  if (data) {
    response.data = data;
  }

  return res.status(statusCode).json(response);
};