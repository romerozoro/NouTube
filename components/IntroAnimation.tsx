import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'

// Short ChuTube intro shown once when the app starts: the logo pops in, a red
// "play" ring pulses out from it, and everything fades into the app.
export function IntroAnimation() {
  const [done, setDone] = useState(false)
  const scale = useRef(new Animated.Value(0.6)).current
  const logoOpacity = useRef(new Animated.Value(0)).current
  const ring = useRef(new Animated.Value(0)).current
  const fade = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 4, tension: 80, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]),
      Animated.timing(ring, { toValue: 1, duration: 550, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.delay(150),
      Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setDone(true))
  }, [])

  if (done) return null

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.2] })
  const ringOpacity = ring.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.9, 0] })

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]}>
      <View style={styles.center}>
        <Animated.View style={[styles.ring, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
        <Animated.Image
          source={require('../assets/images/icon.png')}
          style={[styles.logo, { opacity: logoOpacity, transform: [{ scale }] }]}
        />
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#000', zIndex: 9999, elevation: 9999 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 220, height: 220, borderRadius: 48 },
  ring: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 6,
    borderColor: '#ff1a1a',
  },
})
