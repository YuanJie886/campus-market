package com.lulu.campusmarketbackend.image;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;

/** 阶段 4：上传商品图片（登录用户）与按签名地址读取（不需要令牌，签名本身就是授权）。 */
@RestController
@RequestMapping("/v1/images")
public class ImageController {
    private final AuthService auth;
    private final ImageService images;

    public ImageController(AuthService auth, ImageService images) { this.auth = auth; this.images = images; }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> upload(HttpServletRequest request, @RequestParam("file") MultipartFile file) throws IOException {
        String uid = auth.authenticate(request, false);
        if (file.getSize() > ImageService.MAX_BYTES) throw new ApiException(413, "图片不能超过 5 MB");
        return images.upload(uid, file.getBytes());
    }

    @GetMapping("/{id}")
    public ResponseEntity<byte[]> read(@PathVariable String id, @RequestParam(required = false) String exp,
                                       @RequestParam(required = false) String sig) {
        return images.read(id, exp, sig)
                .map(bytes -> ResponseEntity.ok()
                        .contentType(MediaType.IMAGE_JPEG)
                        .cacheControl(CacheControl.maxAge(Duration.ofHours(1)).cachePrivate())
                        .header("X-Content-Type-Options", "nosniff")
                        .header("Content-Disposition", "inline")
                        .body(bytes))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).build());
    }
}
