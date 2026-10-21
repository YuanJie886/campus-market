package com.lulu.campusmarketbackend.image;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Optional;
import java.util.UUID;

/** 本地目录存放：文件名就是随机 id（不可枚举），先写临时文件再原子改名，不会读到写了一半的文件。 */
@Component
public class LocalImageStore implements ImageStore {
    private final Path root;

    public LocalImageStore(@Value("${campus-market.images.dir:${java.io.tmpdir}/campus-market-images}") String dir) {
        this.root = Path.of(dir).toAbsolutePath().normalize();
        try {
            Files.createDirectories(root);
        } catch (IOException e) {
            throw new UncheckedIOException("图片目录不可用：" + root, e);
        }
    }

    private Path path(UUID id) {
        String name = id.toString();
        return root.resolve(name.substring(0, 2)).resolve(name + ".jpg");
    }

    @Override
    public void put(UUID id, byte[] jpeg) {
        Path target = path(id);
        try {
            Files.createDirectories(target.getParent());
            Path temp = Files.createTempFile(target.getParent(), ".upload-", ".tmp");
            Files.write(temp, jpeg);
            Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public Optional<byte[]> get(UUID id) {
        Path file = path(id);
        try {
            return Files.isRegularFile(file) ? Optional.of(Files.readAllBytes(file)) : Optional.empty();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public void delete(UUID id) {
        try {
            Files.deleteIfExists(path(id));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
