import cv2
import numpy as np
from typing import List, Tuple, Optional

# HSV color ranges for cube colors
# Format: (lower_bound, upper_bound) in HSV
COLOR_RANGES = {
    'U': {  # White
        'lower': np.array([0, 0, 180]),
        'upper': np.array([180, 50, 255])
    },
    'D': {  # Yellow
        'lower': np.array([20, 100, 100]),
        'upper': np.array([35, 255, 255])
    },
    'F': {  # Green
        'lower': np.array([35, 100, 100]),
        'upper': np.array([85, 255, 255])
    },
    'B': {  # Blue
        'lower': np.array([100, 100, 100]),
        'upper': np.array([130, 255, 255])
    },
    'L': {  # Orange
        'lower': np.array([10, 100, 100]),
        'upper': np.array([20, 255, 255])
    },
    'R': {  # Red (wraps around hue axis, two ranges)
        'lower1': np.array([0, 100, 100]),
        'upper1': np.array([10, 255, 255]),
        'lower2': np.array([160, 100, 100]),
        'upper2': np.array([180, 255, 255])
    }
}

def detect_colors(image_path: str) -> Optional[List[str]]:
    """Detect colors on a single face image."""
    try:
        img = cv2.imread(image_path)
        if img is None:
            return None
        
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        
        # Find the cube face region using contour detection
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, 50, 150)
        
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        # Find the largest square-ish contour (the cube face)
        face_contour = None
        for contour in contours:
            area = cv2.contourArea(contour)
            if area > 1000:
                peri = cv2.arcLength(contour, True)
                approx = cv2.approxPolyDP(contour, 0.1 * peri, True)
                if len(approx) == 4:
                    face_contour = approx
                    break
        
        # If no contour found, use the whole image
        if face_contour is None:
            h, w = img.shape[:2]
            face_contour = np.array([[0, 0], [w, 0], [w, h], [0, h]])
        
        # Get bounding box
        x, y, w, h = cv2.boundingRect(face_contour)
        
        # Sample 3x3 grid
        colors = []
        cell_w = w // 3
        cell_h = h // 3
        
        for row in range(3):
            for col in range(3):
                # Sample center region of each cell
                cx = x + col * cell_w + cell_w // 2
                cy = y + row * cell_h + cell_h // 2
                
                # Get average HSV in a small region
                region = hsv[max(0, cy-5):cy+5, max(0, cx-5):cx+5]
                if region.size == 0:
                    colors.append('U')  # default
                    continue
                
                avg_hsv = np.mean(region, axis=(0, 1))
                
                # Match color
                matched = match_color(avg_hsv)
                colors.append(matched)
        
        return colors
    except Exception as e:
        return None

def match_color(hsv_value: np.ndarray) -> str:
    """Match an HSV value to the closest cube color."""
    h, s, v = int(hsv_value[0]), int(hsv_value[1]), int(hsv_value[2])
    
    # White check first (low saturation)
    if s < 50 and v > 180:
        return 'U'
    
    # Check each color range
    best_match = 'U'
    best_score = 0
    
    for color, ranges in COLOR_RANGES.items():
        if color == 'U':
            continue
        
        if color == 'R':
            # Red has two ranges
            if (ranges['lower1'][0] <= h <= ranges['upper1'][0] and 
                ranges['lower1'][1] <= s <= ranges['upper1'][1] and
                ranges['lower1'][2] <= v <= ranges['upper1'][2]):
                return 'R'
            if (ranges['lower2'][0] <= h <= ranges['upper2'][0] and 
                ranges['lower2'][1] <= s <= ranges['upper2'][1] and
                ranges['lower2'][2] <= v <= ranges['upper2'][2]):
                return 'R'
        else:
            if (ranges['lower'][0] <= h <= ranges['upper'][0] and 
                ranges['lower'][1] <= s <= ranges['upper'][1] and
                ranges['lower'][2] <= v <= ranges['upper'][2]):
                return color
    
    return best_match

def detect_cube_state(images: List[str]) -> Optional[str]:
    """Detect cube state from 6 face images."""
    facelets = []
    for img_path in images:
        colors = detect_colors(img_path)
        if colors is None:
            return None
        facelets.extend(colors)
    
    if len(facelets) != 54:
        return None
    
    return ''.join(facelets)

def get_color_statistics(image_path: str) -> dict:
    """Get HSV statistics for each facelet (debug helper)."""
    try:
        img = cv2.imread(image_path)
        if img is None:
            return {}
        
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        h, w = img.shape[:2]
        
        stats = {}
        cell_w = w // 3
        cell_h = h // 3
        
        for row in range(3):
            for col in range(3):
                cx = col * cell_w + cell_w // 2
                cy = row * cell_h + cell_h // 2
                region = hsv[max(0, cy-5):cy+5, max(0, cx-5):cx+5]
                avg = np.mean(region, axis=(0, 1))
                stats[f'{row},{col}'] = {'h': avg[0], 's': avg[1], 'v': avg[2]}
        
        return stats
    except Exception:
        return {}
