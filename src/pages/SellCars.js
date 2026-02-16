import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Car } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import { BuySellSection } from './Garage';
import styles from '../styles/noir.module.css';

export default function SellCars() {
  const [cars, setCars] = useState([]);
  const [dealerCars, setDealerCars] = useState([]);
  const [dealerLoading, setDealerLoading] = useState(true);
  const [userMoney, setUserMoney] = useState(null);
  const [buyingCarId, setBuyingCarId] = useState(null);
  const [marketplaceListings, setMarketplaceListings] = useState([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(true);
  const [buyingListedId, setBuyingListedId] = useState(null);
  const [listPrice, setListPrice] = useState('');
  const [carToList, setCarToList] = useState('');
  const [listingCarId, setListingCarId] = useState(null);
  const [delistingCarId, setDelistingCarId] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    setDealerLoading(true);
    setMarketplaceLoading(true);
    try {
      const [garageRes, saleRes, meRes, marketRes] = await Promise.all([
        api.get('/gta/garage').catch(() => ({ data: { cars: [] } })),
        api.get('/gta/cars-for-sale').catch(() => ({ data: { cars: [] } })),
        api.get('/auth/me').catch(() => ({ data: {} })),
        api.get('/gta/marketplace').catch(() => ({ data: { listings: [] } })),
      ]);
      setCars(Array.isArray(garageRes.data?.cars) ? garageRes.data.cars : []);
      setDealerCars(Array.isArray(saleRes.data?.cars) ? saleRes.data.cars : []);
      setUserMoney(meRes.data?.money ?? null);
      setMarketplaceListings(Array.isArray(marketRes.data?.listings) ? marketRes.data.listings : []);
    } catch (_) {}
    finally {
      setDealerLoading(false);
      setMarketplaceLoading(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchDealerAndMoney = async () => {
    try {
      const [saleRes, meRes, marketRes, garageRes] = await Promise.all([
        api.get('/gta/cars-for-sale').catch(() => ({ data: { cars: [] } })),
        api.get('/auth/me').catch(() => ({ data: {} })),
        api.get('/gta/marketplace').catch(() => ({ data: { listings: [] } })),
        api.get('/gta/garage').catch(() => ({ data: { cars: [] } })),
      ]);
      setDealerCars(Array.isArray(saleRes.data?.cars) ? saleRes.data.cars : []);
      setUserMoney(meRes.data?.money ?? null);
      setMarketplaceListings(Array.isArray(marketRes.data?.listings) ? marketRes.data.listings : []);
      setCars(Array.isArray(garageRes.data?.cars) ? garageRes.data.cars : []);
    } catch (_) {}
  };

  const handleBuyCar = async (carId) => {
    setBuyingCarId(carId);
    try {
      const res = await api.post('/gta/buy-car', { car_id: carId });
      toast.success(res.data?.message || 'Car purchased');
      refreshUser();
      fetchDealerAndMoney();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to buy car');
    } finally {
      setBuyingCarId(null);
    }
  };

  const handleBuyListedCar = async (userCarId) => {
    setBuyingListedId(userCarId);
    try {
      const res = await api.post('/gta/buy-listed-car', { user_car_id: userCarId });
      toast.success(res.data?.message || 'Car purchased');
      refreshUser();
      fetchDealerAndMoney();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to buy car');
    } finally {
      setBuyingListedId(null);
    }
  };

  const handleListCar = async (userCarId, price) => {
    setListingCarId(userCarId);
    try {
      await api.post('/gta/list-car', { user_car_id: userCarId, price });
      toast.success('Car listed for sale');
      setCarToList('');
      setListPrice('');
      fetchDealerAndMoney();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to list car');
    } finally {
      setListingCarId(null);
    }
  };

  const handleDelistCar = async (userCarId) => {
    setDelistingCarId(userCarId);
    try {
      await api.post('/gta/delist-car', { user_car_id: userCarId });
      toast.success('Car delisted');
      fetchDealerAndMoney();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to delist');
    } finally {
      setDelistingCarId(null);
    }
  };

  const myListedCars = (cars || []).filter((c) => c.listed_for_sale);

  if (loading) {
    return (
      <div className={`${styles.pageContent}`}>
        <div className="font-heading text-primary text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`}>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-heading font-bold text-primary uppercase tracking-wide">Sell Cars</h1>
        <Link
          to="/garage"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/30 text-primary font-heading text-xs font-bold hover:bg-primary/10 transition-colors"
        >
          <Car size={14} />
          View garage
        </Link>
      </div>
      <BuySellSection
        dealerCars={dealerCars}
        dealerLoading={dealerLoading}
        userMoney={userMoney}
        onBuyCar={handleBuyCar}
        buyingCarId={buyingCarId}
        marketplaceListings={marketplaceListings}
        marketplaceLoading={marketplaceLoading}
        onBuyListedCar={handleBuyListedCar}
        buyingListedId={buyingListedId}
        myCars={cars}
        myListedCars={myListedCars}
        onListCar={handleListCar}
        onDelistCar={handleDelistCar}
        listPrice={listPrice}
        setListPrice={setListPrice}
        carToList={carToList}
        setCarToList={setCarToList}
        listingCarId={listingCarId}
        delistingCarId={delistingCarId}
      />
    </div>
  );
}
