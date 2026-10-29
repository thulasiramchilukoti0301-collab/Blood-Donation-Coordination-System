import { api } from './api';
import { bookingMutation, createBookingApi } from './bookingApi';

export const bookingApi = createBookingApi(api);
export const sendBookingMutation = input => bookingMutation(input, api);
