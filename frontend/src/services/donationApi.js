import { api } from './api';
import { createDonationApi, donationMutation as sendMutation } from './donationContracts';

export const donationApi = createDonationApi(api);
export const donationMutation = (captured, isCurrent, signal) => sendMutation(captured, isCurrent, signal, api);
export { bookingMutationMessage } from './bookingApi';
