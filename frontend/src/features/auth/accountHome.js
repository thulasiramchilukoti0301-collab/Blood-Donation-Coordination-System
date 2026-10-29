export function accountHome(user) {
  if (user?.role === 'DONOR') return user.accountStatus === 'ACTIVE' ? '/donor' : '/donor/profile';
  if (user?.role === 'HOSPITAL') return '/hospital/profile';
  if (user?.role === 'ADMIN' && user.accountStatus === 'ACTIVE') return '/admin/hospitals';
  return '/account/status';
}
