"""
Mafia Wars API Tests
Tests for: Auth, Users Online, Jail, Admin, Garage, GTA
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://gangsters-haven.preview.emergentagent.com').rstrip('/')

# Test credentials
ADMIN_EMAIL = "admin@mafia.com"
ADMIN_PASSWORD = "mafia123"

class TestAuth:
    """Authentication endpoint tests"""
    
    def test_login_admin_success(self):
        """Test admin login with valid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "token" in data, "Token not in response"
        assert "user" in data, "User not in response"
        assert data["user"]["email"] == ADMIN_EMAIL
        
    def test_login_invalid_credentials(self):
        """Test login with invalid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "wrong@example.com",
            "password": "wrongpass"
        })
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        
    def test_register_new_user(self):
        """Test user registration"""
        unique_id = str(uuid.uuid4())[:8]
        response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": f"TEST_user_{unique_id}@test.com",
            "username": f"TEST_User_{unique_id}",
            "password": "testpass123"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["rank"] == 1  # New users start at rank 1
        assert data["user"]["money"] == 1000.0  # Starting money
        
    def test_get_me_authenticated(self):
        """Test /auth/me with valid token"""
        # First login
        login_res = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        token = login_res.json()["token"]
        
        # Get user info
        response = requests.get(f"{BASE_URL}/api/auth/me", headers={
            "Authorization": f"Bearer {token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert "username" in data
        assert "rank" in data
        assert "money" in data
        
    def test_get_me_unauthenticated(self):
        """Test /auth/me without token"""
        response = requests.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code in [401, 403]


class TestUsersOnline:
    """Users Online endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        return response.json()["token"]
    
    def test_get_online_users(self, auth_token):
        """Test getting online users list"""
        response = requests.get(f"{BASE_URL}/api/users/online", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert "total_online" in data
        assert "users" in data
        assert isinstance(data["users"], list)
        
    def test_online_users_unauthenticated(self):
        """Test online users without auth"""
        response = requests.get(f"{BASE_URL}/api/users/online")
        assert response.status_code in [401, 403]


class TestRankProgress:
    """Rank Progress endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        return response.json()["token"]
    
    def test_get_rank_progress(self, auth_token):
        """Test getting rank progress"""
        response = requests.get(f"{BASE_URL}/api/user/rank-progress", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert "current_rank" in data
        assert "current_rank_name" in data
        assert "money_progress" in data
        assert "rank_points_progress" in data


class TestJail:
    """Jail system endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        return response.json()["token"]
    
    def test_get_jail_status(self, auth_token):
        """Test getting jail status"""
        response = requests.get(f"{BASE_URL}/api/jail/status", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert "in_jail" in data
        
    def test_get_jailed_players(self, auth_token):
        """Test getting jailed players list"""
        response = requests.get(f"{BASE_URL}/api/jail/players", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert "players" in data
        assert isinstance(data["players"], list)


class TestAdmin:
    """Admin endpoint tests"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        return response.json()["token"]
    
    def test_admin_check(self, admin_token):
        """Test admin check endpoint"""
        response = requests.get(f"{BASE_URL}/api/admin/check", headers={
            "Authorization": f"Bearer {admin_token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert "is_admin" in data
        assert data["is_admin"] == True
        
    def test_admin_change_rank(self, admin_token):
        """Test admin change rank - requires target user"""
        # First create a test user
        unique_id = str(uuid.uuid4())[:8]
        reg_res = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": f"TEST_rank_{unique_id}@test.com",
            "username": f"TEST_Rank_{unique_id}",
            "password": "testpass123"
        })
        if reg_res.status_code == 200:
            username = reg_res.json()["user"]["username"]
            
            # Change rank
            response = requests.post(
                f"{BASE_URL}/api/admin/change-rank?target_username={username}&new_rank=5",
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            assert response.status_code == 200
            assert "message" in response.json()
            
    def test_admin_add_points(self, admin_token):
        """Test admin add points"""
        unique_id = str(uuid.uuid4())[:8]
        reg_res = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": f"TEST_points_{unique_id}@test.com",
            "username": f"TEST_Points_{unique_id}",
            "password": "testpass123"
        })
        if reg_res.status_code == 200:
            username = reg_res.json()["user"]["username"]
            
            response = requests.post(
                f"{BASE_URL}/api/admin/add-points?target_username={username}&points=100",
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            assert response.status_code == 200
            
    def test_admin_add_car(self, admin_token):
        """Test admin add car"""
        unique_id = str(uuid.uuid4())[:8]
        reg_res = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": f"TEST_car_{unique_id}@test.com",
            "username": f"TEST_Car_{unique_id}",
            "password": "testpass123"
        })
        if reg_res.status_code == 200:
            username = reg_res.json()["user"]["username"]
            
            response = requests.post(
                f"{BASE_URL}/api/admin/add-car?target_username={username}&car_id=car1",
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            assert response.status_code == 200
            
    def test_admin_lock_player(self, admin_token):
        """Test admin lock player"""
        unique_id = str(uuid.uuid4())[:8]
        reg_res = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": f"TEST_lock_{unique_id}@test.com",
            "username": f"TEST_Lock_{unique_id}",
            "password": "testpass123"
        })
        if reg_res.status_code == 200:
            username = reg_res.json()["user"]["username"]
            
            response = requests.post(
                f"{BASE_URL}/api/admin/lock-player?target_username={username}&lock_minutes=1",
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            assert response.status_code == 200
            
    def test_admin_kill_player(self, admin_token):
        """Test admin kill player"""
        unique_id = str(uuid.uuid4())[:8]
        reg_res = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": f"TEST_kill_{unique_id}@test.com",
            "username": f"TEST_Kill_{unique_id}",
            "password": "testpass123"
        })
        if reg_res.status_code == 200:
            username = reg_res.json()["user"]["username"]
            
            response = requests.post(
                f"{BASE_URL}/api/admin/kill-player?target_username={username}",
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            assert response.status_code == 200


class TestGTA:
    """GTA (Grand Theft Auto) endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        return response.json()["token"]
    
    def test_get_gta_options(self, auth_token):
        """Test getting GTA options"""
        response = requests.get(f"{BASE_URL}/api/gta/options", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        # Check structure
        assert "id" in data[0]
        assert "name" in data[0]
        assert "success_rate" in data[0]


class TestGarage:
    """Garage endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        return response.json()["token"]
    
    def test_get_garage(self, auth_token):
        """Test getting garage contents"""
        response = requests.get(f"{BASE_URL}/api/gta/garage", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert "cars" in data
        assert isinstance(data["cars"], list)


class TestLeaderboard:
    """Leaderboard endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        return response.json()["token"]
    
    def test_get_leaderboard(self, auth_token):
        """Test getting leaderboard"""
        response = requests.get(f"{BASE_URL}/api/leaderboard", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "username" in data[0]
            assert "money" in data[0]
            assert "rank" in data[0]
