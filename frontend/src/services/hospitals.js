import { api } from './api';
import { createHospitalApi } from './hospitalApi';

export const {
  registerHospital, getHospitalProfile, updateHospitalProfile, listAdminHospitals, getAdminHospitalProfile,
} = createHospitalApi(api);
