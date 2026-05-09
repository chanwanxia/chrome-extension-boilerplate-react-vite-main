import { RingLoader } from 'react-spinners';
export const LoadingSpinner = ({ size }) => (
  <div className={'flex min-h-screen items-center justify-center'}>
    <RingLoader size={size ?? 100} color={'aqua'} />
  </div>
);
